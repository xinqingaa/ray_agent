/* eslint-disable @typescript-eslint/no-require-imports */
// 实际投影、Markdown 渲染和状态组件；合成协议事件，不连接模型或浏览器。
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const req = require('node:module').createRequire(path.join(root, 'package.json'));
const ts = req('typescript'), React = req('react'), {renderToStaticMarkup} = req('react-dom/server');
const cache = new Map();
function load(relative) {
  const filename = path.join(root, relative);
  if (cache.has(filename)) return cache.get(filename).exports;
  const m = {exports: {}}; cache.set(filename, m);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  }}).outputText;
  new Function('require', 'module', 'exports', code)(name => {
    if (name.startsWith('@/') || name.startsWith('.')) {
      const base = name.startsWith('@/') ? path.join(root, 'src', name.slice(2)) : path.resolve(path.dirname(filename), name);
      return load(path.relative(root, ['.ts', '.tsx'].map(ext => base + ext).find(f => fs.existsSync(f))));
    }
    return req(name);
  }, m, m.exports);
  return m.exports;
}
const {projectSession} = load('src/lib/session-projection.ts');
const {RunStatus} = load('src/components/run/run-status.tsx');
const {MarkdownContent} = load('src/components/markdown-content.tsx');
const {PlanBar, PlanContent} = load('src/components/run/plan-bar.tsx');
const markup = (Component, props) => renderToStaticMarkup(React.createElement(Component, props));
const ev = (seq, event, data) => ({event, data: {seq, run_id: 'r', created_at: 1000 + seq, ...data}});
const running = [ev(1, 'run', {status: 'running'}), ev(2, 'message', {role: 'user', message: '执行'}),
  ev(3, 'turn', {phase: 'started', index: 1}),
  ev(4, 'tool', {name: 'file', function: 'write_file', tool_call_id: 'c', status: 'calling'}),
  ev(5, 'tool', {name: 'file', function: 'write_file', tool_call_id: 'c', status: 'called', content: {outcome: {success: true}}}),
  ev(6, 'turn', {phase: 'completed', index: 1}), ev(7, 'turn', {phase: 'started', index: 2})];
const props = view => ({place: 'timeline', compacting: false, pendingSend: false,
  activity: view.activeRun?.activity.kind, streaming: !!view.streaming?.text, running: view.activeRun?.status === 'running'});
let view = projectSession({id: 's', events: running});
assert.equal(view.timeline.at(-1).kind, 'tools');
assert.match(markup(RunStatus, props(view)), /正在思考/);
assert.equal(markup(RunStatus, {...props(view), streaming: true}), '');
assert.equal(markup(RunStatus, {...props(view), activity: 'tool'}), '');
assert.equal(markup(RunStatus, {...props(view), activity: 'waiting_reply'}), '');
assert.equal(markup(RunStatus, {...props(view), activity: 'waiting_approval'}), '');
assert.match(markup(RunStatus, {...props(view), activity: 'stopping'}), /正在停止/);
assert.match(markup(RunStatus, {...props(view), activity: 'preparing_environment'}), /正在准备执行环境/);
for (const status of ['completed', 'cancelled', 'failed', 'interrupted']) {
  view = projectSession({id: 's', events: [...running, ev(8, 'run', {status})]});
  assert.equal(markup(RunStatus, props(view)), '');
}
const rawFile = id => ({id, filename: '结果 演示.html', filepath: '/home/ubuntu/结果 演示.html', size: 10});
const content = '[下载](</home/ubuntu/结果 演示.html>)';
view = projectSession({id: 's', events: [ev(1, 'run', {status: 'running'}),
  ev(2, 'message', {role: 'user', message: '制作', attachments: [rawFile('upload')]}),
  ev(3, 'message', {role: 'assistant', message: content}),
  ev(4, 'message', {role: 'assistant', message: '已交付', attachments: [rawFile('old')]}),
  ev(5, 'message', {role: 'assistant', message: content}), ev(6, 'run', {status: 'completed'}),
  ev(7, 'run', {run_id: 'r2', status: 'running'}),
  ev(8, 'message', {run_id: 'r2', role: 'user', message: '修改'}),
  ev(9, 'message', {run_id: 'r2', role: 'assistant', message: '新版', attachments: [rawFile('new')]}),
  ev(10, 'message', {run_id: 'r2', role: 'assistant', message: content}), ev(11, 'run', {run_id: 'r2', status: 'completed'})]});
const before = view.timeline.find(item => item.id === 'e3');
const old = view.timeline.find(item => item.id === 'e5');
const latest = view.timeline.find(item => item.id === 'e10');
assert.deepEqual(before.deliveredFiles, []); // 延迟归并的早期旁白也不能关联未来交付。
assert.equal(old.deliveredFiles[0].id, 'old'); assert.equal(latest.deliveredFiles[0].id, 'new');
assert.doesNotMatch(markup(MarkdownContent, {content, deliveredFiles: before.deliveredFiles}), /href=/);
assert.match(markup(MarkdownContent, {content, deliveredFiles: old.deliveredFiles}), /files\/old\/download/);
assert.doesNotMatch(markup(MarkdownContent, {content, deliveredFiles: old.deliveredFiles}), /files\/new/);
for (const url of ['/home/ubuntu/%E7%BB%93%E6%9E%9C%20%E6%BC%94%E7%A4%BA.html', 'sandbox:/home/ubuntu/结果%20演示.html', 'file:///home/ubuntu/结果%20演示.html']) {
  assert.match(markup(MarkdownContent, {content: `[下载](<${url}>)`, deliveredFiles: latest.deliveredFiles}), /files\/new\/download/);
}
for (const url of ['/home/ubuntu/missing.html', 'sandbox:/unknown/missing', 'file://remote/share']) {
  assert.doesNotMatch(markup(MarkdownContent, {content: `[下载](${url})`, deliveredFiles: []}), /href=/);
}
assert.match(markup(MarkdownContent, {content: '[网页](https://example.com/docs)', deliveredFiles: []}), /href="https:\/\/example.com\/docs"/);
assert.match(markup(MarkdownContent, {content: '[页面](/docs/index.html)', deliveredFiles: []}), /href="\/docs\/index.html"/);
assert.doesNotMatch(markup(MarkdownContent, {content: '[危险](javascript:alert%281%29)', deliveredFiles: []}), /href="javascript:/);
const ambiguous = projectSession({id: 's', events: [ev(1, 'run', {status: 'running'}),
  ev(2, 'message', {role: 'assistant', message: '附件', attachments: [rawFile('a'), rawFile('b')]}),
  ev(3, 'message', {role: 'assistant', message: content}), ev(4, 'run', {status: 'completed'})]});
assert.doesNotMatch(markup(MarkdownContent, {content, deliveredFiles: ambiguous.timeline.find(item => item.id === 'e3').deliveredFiles}), /href=/);
assert.doesNotMatch(markup(MarkdownContent, {content, deliveredFiles: [{...old.deliveredFiles[0]}, {...old.deliveredFiles[0], id: 'other'}]}), /href=/);
const plan = projectSession({id: 's', events: [ev(1, 'run', {status: 'running'}), ev(2, 'plan', {plan_id: 'p', steps: [
  {id: 'stage', kind: 'stage', description: '制作', status: 'running'},
  {id: 'a', kind: 'step', parent_id: 'stage', description: '内容', status: 'completed'},
  {id: 'b', kind: 'step', parent_id: 'stage', description: '交互', status: 'running'},
  {id: 'c', kind: 'step', parent_id: 'stage', description: '核验', status: 'pending'}]})]});
assert.match(markup(PlanBar, {plan: plan.plan, runStatus: 'running'}), />制作<\/span>/);
assert.match(markup(PlanBar, {plan: plan.plan, runStatus: 'running'}), />交互<\/span>/);
assert.match(markup(PlanBar, {plan: plan.plan, runStatus: 'running'}), /已完成 0\/1 阶段/);
assert.doesNotMatch(markup(PlanBar, {plan: plan.plan, runStatus: 'running'}), /子步骤已完成/);
const expanded = markup(PlanBar, {plan: plan.plan, runStatus: 'running', defaultOpen: true});
assert.doesNotMatch(expanded, /已完成 \d+\/\d+|子步骤已完成/);
assert.match(expanded, /收起计划/);
const contentMarkup = markup(PlanContent, {plan: plan.plan, active: true, ended: false});
assert.doesNotMatch(contentMarkup, /已完成 \d+\/\d+|子步骤已完成/);
assert.equal((contentMarkup.match(/<li /g) || []).length, 4);
assert.match(contentMarkup, />进行中</); assert.match(contentMarkup, />已完成</); assert.match(contentMarkup, />未开始</);
assert.doesNotMatch(markup(PlanBar, {plan: plan.plan, proposal: true}), /子步骤已完成/);
console.log('PASS: 工具后的思考状态、状态切换与终态；实际 Markdown 文件链接、交付时序/版本/中文/协议与安全边界；当前子步骤、收起整体进度与展开不重复计数');
