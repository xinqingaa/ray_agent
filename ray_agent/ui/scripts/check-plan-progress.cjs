/* eslint-disable @typescript-eslint/no-require-imports */
// 实际投影与组件，合成事件；不连接模型或浏览器。
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const req = require('node:module').createRequire(path.join(root, 'package.json'));
const ts = req('typescript'), React = req('react'), {renderToStaticMarkup} = req('react-dom/server');
const cache = new Map();
let metrics = false;
function load(relative) {
  const filename = path.join(root, relative);
  if (cache.has(filename)) return cache.get(filename).exports;
  const m = {exports: {}}; cache.set(filename, m);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  }}).outputText;
  new Function('require', 'module', 'exports', code)(name => {
    if (name === '@/hooks/use-developer-mode') return {useDeveloperMode: () => ({visibility: {requestMetrics: metrics}})};
    if (name.startsWith('@/') || name.startsWith('.')) {
      const base = name.startsWith('@/') ? path.join(root, 'src', name.slice(2)) : path.resolve(path.dirname(filename), name);
      return load(path.relative(root, ['.ts', '.tsx'].map(ext => base + ext).find(f => fs.existsSync(f))));
    }
    return req(name);
  }, m, m.exports);
  return m.exports;
}
const {projectSession} = load('src/lib/session-projection.ts');
const {PlanBar, PlanContent} = load('src/components/run/plan-bar.tsx');
const {RunEndBar} = load('src/components/run/run-end-bar.tsx');
const {AttemptNotice} = load('src/components/run/notices.tsx');
const {RunStatus} = load('src/components/run/run-status.tsx');
const ev = (seq, event, data) => ({event, data: {seq, run_id: 'r', created_at: 1000 + seq, ...data}});
const markup = (Component, props) => renderToStaticMarkup(React.createElement(Component, props));
const initial = [ev(1, 'run', {status: 'running'}), ev(2, 'plan', {plan_id: 'p', explanation: '初始安排', steps: [
  {id: 'a', description: '需求', status: 'completed'}, {id: 'b', description: '结构', status: 'running'},
  {id: 'c', description: '正文', status: 'pending'},
]})];
let view = projectSession({id: 's', events: initial});
let html = markup(PlanBar, {plan: view.plan, runStatus: 'running', defaultOpen: false});
assert.match(html, /第 2\/3 步/); assert.doesNotMatch(html, /<ol|初始安排/);
assert.match(markup(PlanContent, {plan: view.plan, active: true, ended: false}), /已完成 1\/3 项/);
const renamed = [...initial, ev(3, 'plan', {plan_id: 'p', explanation: '调整标题与顺序', steps: [
  {id: 'a', description: '需求', status: 'completed'}, {id: 'c', description: '编写页面', status: 'running'},
  {id: 'b', description: '结构', status: 'completed'},
]})];
view = projectSession({id: 's', events: renamed});
assert.ok(view.plan.changed.some(c => c.kind === 'text')); assert.ok(view.plan.changed.some(c => c.kind === 'order'));
assert.ok(!view.plan.changed.some(c => c.kind === 'added' || c.kind === 'removed'));
assert.equal(view.plan.items.find(i => i.id === 'b').startedAt, 1002);
const final = [...renamed, ev(4, 'plan', {plan_id: 'p', explanation: '', steps: [
  {id: 'a', description: '需求', status: 'completed'}, {id: 'c', description: '编写页面', status: 'completed'},
]}), ev(5, 'run', {status: 'completed'})];
view = projectSession({id: 's', events: final});
html = markup(PlanBar, {plan: view.plan, runStatus: 'completed', defaultOpen: false});
const mainList = markup(PlanContent, {plan: view.plan, active: false, ended: true});
assert.equal((mainList.match(/<li /g) || []).length, 2); assert.doesNotMatch(mainList, /已删除|新增|刚完成|结构/);
assert.match(html, /计划 2\/2 项已完成/); assert.doesNotMatch(mainList, /计划更新记录|第 .*版|<details/);
assert.equal(view.plan.explanation, null);
const reset = projectSession({id: 's', events: [...final, ev(6, 'plan', {plan_id: 'new', steps: [
  {id: 'new-step', description: '新任务', status: 'running'},
]})]});
assert.equal(reset.plan.version, 1); assert.deepEqual(reset.plan.changed, []);
html = markup(PlanBar, {plan: view.plan, runStatus: 'completed', previousRun: true});
assert.match(html, /上次计划/); assert.doesNotMatch(html, /第 .*步/);
html = markup(RunEndBar, {status: 'cancelled', reasonText: '已停止生成'});
assert.equal((html.match(/已停止生成/g) || []).length, 1);
assert.doesNotMatch(html, /沙箱|你停止了|新的运行/); assert.match(html, /接着处理/);
assert.equal(markup(AttemptNotice, {attempt: 1, reason: 'cancelled', retried: false}), '');
assert.equal(markup(RunStatus, {place: 'headline', status: 'cancelled', compacting: false}), '');
metrics = true;
assert.match(markup(AttemptNotice, {attempt: 1, reason: 'cancelled', retried: false}), /第 1 次请求已停止/);
console.log('PASS: 当前步骤/完成数量、身份与重排、重置、最终有效清单、关闭时无清单 DOM、只显示最新快照和停止记录通过实际组件检查');
