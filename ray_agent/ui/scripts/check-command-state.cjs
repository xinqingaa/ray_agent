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
  projectsEnabled: false, projectBindable: false,
  actions: {compact: () => calls.push('compact'), openFilePicker: () => calls.push('upload'), togglePlan: () => calls.push('plan'), openProjectPicker: () => calls.push('project')},
};
assert.deepEqual(matchingCommands('', context, 'plus').map(x => x.id), ['plan','compact']);
assert.equal(matchingCommands('project', context)[0].title, '打开项目');
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
assert.equal(commandById('project').available({...context, runStatus:'running', submitting:true}).available, true);
for (const command of inputCommands) command.run(context);
assert.deepEqual(calls, ['upload','plan','compact','project']);
console.log('PASS: plus/slash surfaces share guarded actions; busy/waiting disables mutation, project navigation remains discoverable');

const {createProjectRefreshWatcher} = load('src/lib/project-refresh.ts');
const realSetTimeout = global.setTimeout;
const realClearTimeout = global.clearTimeout;
let nextId = 0;
const timers = new Map();
global.setTimeout = fn => {const id = ++nextId; timers.set(id, fn); return id};
global.clearTimeout = id => timers.delete(id);
try {
  let refreshes = 0;
  const watcher = createProjectRefreshWatcher(() => refreshes++);
  const written = {type:'tool',data:{seq:1,status:'called',function:'write_file'}};
  const turn = {type:'turn',data:{seq:2,status:'completed'}};
  watcher.observe([written]);
  watcher.observe([written,turn]);
  assert.equal(timers.size,1);
  const shell = {type:'tool',data:{seq:3,status:'called',function:'shell_execute'}};
  watcher.observe([written,turn,shell]);
  watcher.observe([written,turn,shell,{type:'message',data:{seq:4}}]);
  assert.equal(timers.size,1);
  const pending = [...timers.values()][0]; timers.clear(); pending();
  assert.equal(refreshes,1);
  watcher.observe([written,turn,shell]); assert.equal(timers.size,0);
  watcher.observe([{...written,data:{...written.data,seq:5}}]);
  watcher.dispose(); assert.equal(timers.size,0);
  console.log('PASS: write/Shell burst coalesces; later turn/message cannot cancel last refresh; disposal cancels owned timer');
} finally {global.setTimeout = realSetTimeout; global.clearTimeout = realClearTimeout}
