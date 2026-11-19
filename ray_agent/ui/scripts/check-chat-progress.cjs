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
      const file = ['.ts', '.tsx', '/index.ts', '/index.tsx'].map(ext => base + ext).find(f => fs.existsSync(f));
      if (!file) throw new Error(`找不到模块 ${name}，来源 ${relative}`);
      return load(path.relative(root, file));
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
const {resolveMessageFileLink} = load('src/lib/message-file-links.ts');
const download = /<button type="button" title="下载 结果 演示.html"/;
assert.doesNotMatch(markup(MarkdownContent, {content, deliveredFiles: before.deliveredFiles}), /href=|<button/);
assert.match(markup(MarkdownContent, {content, deliveredFiles: old.deliveredFiles}), download);
assert.equal(resolveMessageFileLink('/home/ubuntu/结果 演示.html', old.deliveredFiles).id, 'old');
for (const url of ['/home/ubuntu/%E7%BB%93%E6%9E%9C%20%E6%BC%94%E7%A4%BA.html', 'sandbox:/home/ubuntu/结果%20演示.html', 'file:///home/ubuntu/结果%20演示.html']) {
  assert.match(markup(MarkdownContent, {content: `[下载](<${url}>)`, deliveredFiles: latest.deliveredFiles}), download);
  assert.equal(resolveMessageFileLink(url, latest.deliveredFiles).id, 'new');
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
const collapsed = markup(PlanBar, {plan: plan.plan, runStatus: 'running'});
assert.match(collapsed, />制作<\/span>/);
assert.match(collapsed, />交互<\/span>/);
assert.match(collapsed, /已完成 0\/1 阶段/);
assert.match(collapsed, /flex-nowrap/);
assert.doesNotMatch(collapsed, /子步骤已完成|bg-state-running|bg-state-success|bg-signal/);
const expanded = markup(PlanBar, {plan: plan.plan, runStatus: 'running', defaultOpen: true});
assert.equal((expanded.match(/已完成 \d+\/\d+/g) || []).length, 1);
// The expanded checklist sits above the fixed bottom trigger and is linked by aria-controls.
const region = expanded.match(/id="([^"]+)" role="region" aria-label="当前计划"/);
assert.ok(region && expanded.indexOf(region[0]) < expanded.indexOf('aria-expanded="true"'));
assert.ok(expanded.includes(`aria-controls="${region[1]}"`));
assert.match(expanded, /class="sr-only">收起计划/);
assert.match(expanded, /收起计划/);
assert.match(expanded, /animate-spin/); assert.doesNotMatch(expanded, /text-signal|bg-signal/);
assert.doesNotMatch(markup(PlanContent, {plan: plan.plan, active: false, ended: true}), /animate-spin/);
const contentMarkup = markup(PlanContent, {plan: plan.plan, active: true, ended: false});
assert.doesNotMatch(contentMarkup, /已完成 \d+\/\d+|子步骤已完成/);
assert.equal((contentMarkup.match(/<li /g) || []).length, 4);
assert.match(contentMarkup, /text-lg font-semibold/);
assert.match(contentMarkup, />进行中</); assert.match(contentMarkup, />已完成</); assert.match(contentMarkup, />未开始</);
assert.doesNotMatch(markup(PlanBar, {plan: plan.plan, proposal: true}), /子步骤已完成/);
console.log('PASS: 工具后的思考状态、状态切换与终态；实际 Markdown 文件链接、交付时序/版本/中文/协议与安全边界；当前子步骤、收起整体进度与展开不重复计数');

// 实际展开组件配合延迟请求，防止首个响应被自己的 loading 更新取消。
const {act, create} = req('react-test-renderer');
const {RunReferences} = load('src/components/run/run-references.tsx');
const {memoryApi} = load('src/lib/api/memory.ts');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
async function assertReferenceLoading() {
  const requests = [];
  memoryApi.contextManifest = id => new Promise((resolve, reject) => requests.push({id, resolve, reject}));
  const openedSources = [];
  const render = (runId, replyText = '') => React.createElement(RunReferences, {
    runId, replyText, onOpenSource: source => openedSources.push(source),
  });
  const manifest = instruction_body => ({instruction_body, resident_memories: [], retrieval_hits: [], omissions: []});
  let tree;
  const replyText = '已核对[来源](#rayagent-source-doc)，补充[旧版](#rayagent-source-old)，再次提及[来源](#rayagent-source-doc)。';
  await act(async () => { tree = create(render('one', replyText)); });
  const toggle = () => tree.root.findAllByType('button')[0].props.onClick();
  const reveal = () => tree.root.findByProps({className: 'run-reference-reveal'}).props;
  const context = () => tree.root.findByProps({className: 'run-context-reveal'});
  const toggleContext = () => tree.root.findByProps({className: 'run-context-trigger'}).props.onClick({});
  const contents = () => JSON.stringify(tree.toJSON());
  await act(async () => { toggle(); });
  assert.equal(requests[0].id, 'one');
  assert.match(contents(), /正在读取/);
  const explicit = {source_type: 'document_chunk', source_id: 'doc', source_version: 2, title: '阈值.pdf', snippet: '现行阈值 82', payload: {relative_path: '规范/阈值.pdf', locator: {page: 2}}};
  const historical = {...explicit, source_id: 'old', source_version: 1, title: '旧规范.pdf', snippet: '历史阈值 73', stale: true,
    payload: {locator: {page: 2}}};
  const requested = {...explicit, source_id: 'extra', title: '补充.pdf', snippet: '说明', payload: {}};
  const resident = [{memory_id: 'm0', content: '常驻条目', memory_type: 'fact', version: 1}];
  await act(async () => { requests[0].resolve({...manifest('第一份工作方式'), instruction_version: 22,
    citation_sources: [historical, explicit], explicit_hits: [requested, explicit], retrieval_hits: [historical], resident_memories: resident}); });
  const headings = tree.root.findAllByType('h4').map(heading => heading.children[0]);
  assert.deepEqual(headings, ['正文引用', '你指定的材料']);
  const citedList = tree.root.findByProps({'aria-label': '正文引用'});
  assert.deepEqual(citedList.findAllByProps({className: 'run-document-excerpt'}).map(excerpt => excerpt.children[0]), ['现行阈值 82', '历史阈值 73']);
  assert.deepEqual(citedList.findAllByProps({className: 'reply-citation-number run-document-number'}).map(badge => badge.children[0]), ['1', '2']);
  assert.match(contents(), /第 2 页 · v2/);
  assert.match(contents(), /历史版本/);
  assert.doesNotMatch(contents(), /第一份工作方式|常驻条目|收起摘录|展开摘录|打开原文/);
  const fileLinks = citedList.findAllByProps({className: 'run-document-name run-document-link'});
  fileLinks[0].props.onClick();
  fileLinks[1].props.onClick();
  assert.deepEqual(openedSources.map(source => [source.source_id, source.source_version]), [['doc', 2], ['old', 1]]);
  assert.equal(context().props.inert, true);
  await act(async () => { toggleContext(); });
  assert.equal(context().props['data-open'], true);
  assert.equal(context().props.inert, false);
  const contextContent = tree.root.findByProps({className: 'run-context-content'});
  assert.match(contents(), /第一份工作方式|常驻条目/);
  await act(async () => { toggleContext(); });
  assert.equal(context().props.inert, true);
  assert.equal(tree.root.findByProps({className: 'run-context-content'}), contextContent);
  await act(async () => { toggleContext(); });
  assert.equal(context().props.inert, false);
  assert.equal(tree.root.findAllByProps({className: 'run-document-excerpt'}).length, 3);
  await act(async () => { toggle(); });
  assert.equal(reveal().inert, true);
  await act(async () => { toggle(); });
  assert.equal(requests.length, 1);
  assert.equal(reveal().inert, false);

  await act(async () => { tree.update(render('two')); });
  await act(async () => { toggle(); });
  await act(async () => { tree.update(render('three')); });
  await act(async () => { toggle(); });
  await act(async () => { requests[1].resolve(manifest('迟到的内容')); });
  assert.doesNotMatch(contents(), /迟到的内容/);
  await act(async () => { requests[2].reject(new Error('加载失败')); });
  assert.match(contents(), /加载失败/);
  await act(async () => { tree.root.findAllByType('button')[1].props.onClick(); });
  assert.equal(requests[3].id, 'three');
  await act(async () => { requests[3].resolve(manifest('重试恢复')); });
  assert.match(contents(), /运行详情/);
  await act(async () => { toggleContext(); });
  assert.match(contents(), /重试恢复/);
  await act(async () => { tree.unmount(); });
  console.log('PASS: 本次参考的角标顺序、直接摘录、文件名预览、来源去重、详情开合、迟到响应与重试');
}
assertReferenceLoading().catch(error => { console.error(error); process.exitCode = 1; });
