// 执行实际命令注册表；动作由受控替身记录。
/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createRequire} = require('node:module');
const root = path.resolve(__dirname, '..');
const localRequire = createRequire(path.join(root, 'package.json'));
const ts = localRequire('typescript');
const cache = new Map();
function load(relative) {
  const filename = path.join(root, relative);
  if (cache.has(filename)) return cache.get(filename);
  const loaded = {exports: {}};
  cache.set(filename, loaded.exports);
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: false,
    },
  }).outputText;
  new Function('require', 'module', 'exports', compiled)(
    (name) => {
      if (name.startsWith('@/')) return load(`src/${name.slice(2)}.ts`);
      if (name.startsWith('.')) {
        const resolved = path.resolve(path.dirname(filename), name);
        const file = resolved.endsWith('.ts') ? resolved : `${resolved}.ts`;
        return load(path.relative(root, file));
      }
      return localRequire(name);
    },
    loaded,
    loaded.exports,
  );
  return loaded.exports;
}

const {inputCommands, matchingCommands, commandById} = load('src/lib/commands.ts');
const calls = [];
const context = {
  hasSession: true, hasRuns: true, runStatus: 'completed', waitingApproval: false,
  waitingReply: false, submitting: false, uploading: false, compacting: false, planMode: true,
  actions: {compact: () => calls.push('compact'), openFilePicker: () => calls.push('upload'), togglePlan: () => calls.push('plan')},
};
assert.deepEqual(matchingCommands('', context, 'plus').map(x => x.id), ['plan','compact']);
assert.deepEqual(matchingCommands('project', context), []);
assert.equal(commandById('project'), undefined);
assert.equal(commandById('plan').title, '计划模式');
for (const busy of ['submitting','uploading','compacting']) {
  for (const id of ['upload','plan','compact']) {
    const command = commandById(id);
    const blocked = {...context, [busy]: true};
    assert.equal(command.available(blocked).available, false);
    command.run(blocked);
  }
}
assert.deepEqual(calls, []);
for (const status of ['running','waiting']) {
  assert.equal(commandById('plan').available({...context, runStatus: status}).available, false);
  assert.equal(commandById('compact').available({...context, runStatus: status}).available, false);
}
assert.equal(commandById('upload').available({...context, waitingApproval: true}).available, false);
assert.equal(commandById('compact').available({...context, hasRuns: false}).available, false);
assert.equal(commandById('compact').available({...context, hasSession: false}).available, false);
for (const command of inputCommands) command.run(context);
assert.deepEqual(calls, ['upload','plan','compact']);
console.log('PASS: plus/slash surfaces share guarded actions; busy/waiting disables mutation, project command removed');
