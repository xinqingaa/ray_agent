// `/` 提示的触发判定与片段移除。转译实际模块，不启动 Next.js，不连接服务。
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

const {findSlashTrigger, removeSlashFragment, matchesCommandQuery} = load('src/lib/slash-trigger.ts');

const atStart = findSlashTrigger('/upload', '/upload'.length, false);
assert.deepEqual(atStart, {start: 0, end: 7, query: 'upload'});
assert.equal(findSlashTrigger('/', 1, false).query, '');
const midToken = findSlashTrigger('/upload', 3, false);
assert.equal(midToken.query, 'upload');
assert.equal(midToken.end, 7);
console.log('PASS: 输入开头的 / 触发，查询是 / 后的整段非空白');

const afterSpace = '请 /upload';
const spaced = findSlashTrigger(afterSpace, afterSpace.length, false);
assert.equal(spaced.start, 2);
assert.equal(spaced.query, 'upload');
const afterNewline = '请\n/plan';
assert.equal(findSlashTrigger(afterNewline, afterNewline.length, false).query, 'plan');
const closed = '请 /upload 处理';
assert.equal(findSlashTrigger(closed, closed.length, false), null);
console.log('PASS: 空白或换行后的 / 触发，空白结束片段后不再触发');

const pathText = 'src/lib/commands.ts';
assert.equal(findSlashTrigger(pathText, pathText.length, false), null);
assert.equal(findSlashTrigger(pathText, pathText.indexOf('/') + 1, false), null);
assert.equal(findSlashTrigger(`cat ${pathText}`, `cat ${pathText}`.length, false), null);
const pathLike = '看 /src/lib';
const pathLikeHit = findSlashTrigger(pathLike, pathLike.length, false);
assert.equal(pathLikeHit.query, 'src/lib');
console.log('PASS: 路径中的 / 不触发；空白后的 / 仍按命令查询');

assert.equal(findSlashTrigger('/upload', 7, true), null);
assert.equal(findSlashTrigger('请 /up', 6, true), null);
console.log('PASS: 组合输入期间不触发');

const source = '请 /upload 处理';
const fragment = findSlashTrigger(source, source.indexOf('/upload') + '/upload'.length, false);
assert.ok(fragment);
const removed = removeSlashFragment(source, fragment.end, fragment);
assert.equal(removed.text, '请  处理');
assert.equal(removed.cursor, fragment.start);
const mid = source.indexOf('/upload') + 3;
const midRemoved = removeSlashFragment(source, mid, fragment);
assert.equal(midRemoved.text, '请  处理');
assert.equal(midRemoved.cursor, fragment.start);
const after = removeSlashFragment(source, source.length, fragment);
assert.equal(after.text, '请  处理');
assert.equal(after.cursor, '请  处理'.length);
const before = removeSlashFragment(source, 1, fragment);
assert.equal(before.text, '请  处理');
assert.equal(before.cursor, 1);
console.log('PASS: 移除 /xxx 后保留其余文字，光标落在片段原处');

assert.equal(matchesCommandQuery('', ['upload', '上传附件']), true);
assert.equal(matchesCommandQuery('UP', ['upload', '上传附件']), true);
assert.equal(matchesCommandQuery('附件', ['upload', '上传附件']), true);
assert.equal(matchesCommandQuery('plan', ['upload', '上传附件']), false);
console.log('PASS: 空查询匹配全部，关键字与标题不区分大小写');
