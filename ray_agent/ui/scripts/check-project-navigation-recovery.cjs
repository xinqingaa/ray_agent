// 实际 React 组件回归：API、路由和基础 UI 用替身；不代替真实浏览器验收。
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const ts = require(root + '/node_modules/typescript');
const React = require('react');
const {create, act} = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;
global.document = {visibilityState: 'visible'};
const storage = new Map();
global.localStorage = {getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value)};
global.requestAnimationFrame = callback => setImmediate(callback);
global.cancelAnimationFrame = clearImmediate;
const api = {}, sessionApi = {};
let pathname = '/';
const workspace = {projects: [], total: 0, loading: false, error: null, refresh: async () => {}, more: async () => {}, openProject() {}};
const sessions = [];
const elements = new Proxy({}, {get: (_, name) => props => React.createElement(name === 'Button' ? 'button' : 'div', props, props.children)});
const empty = () => null;
function load(file) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(root + '/src/' + file, 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX},
  }).outputText;
  new Function('require', 'exports', code)(name => {
    if (name === 'react') return React;
    if (name === 'react/jsx-runtime') return require(name);
    if (name === 'next/link') return {default: props => React.createElement('a', props, props.children)};
    if (name === 'next/navigation') return {useRouter: () => ({push() {}}), usePathname: () => pathname};
    if (name === 'lucide-react') return new Proxy({}, {get: () => empty});
    if (name === 'sonner') return {toast: {error() {}}};
    if (name === '@/lib/api/project') return {projectApi: api};
    if (name === '@/lib/api/session') return {sessionApi};
    if (name === '@/lib/utils') return {cn: (...values) => values.filter(Boolean).join(' ')};
    if (name === '@/providers/projects-provider') return {useProjects: () => workspace};
    if (name === '@/hooks/use-sessions') return {useSessions: () => ({sessions, refresh: async () => {}, deleteSession: async () => true, patchSession() {}})};
    if (name === '@/components/project-navigation') return {ProjectNavigation: props => React.createElement('nav', props)};
    if (name === '@/components/project-state-notice') return {ProjectStateNotice: empty, projectWriteReason: project => project?.file_operation ? '文件占用' : null};
    if (name === '@/components/run/format') return {formatBytes: String};
    if (name === '@/components/ui/sidebar') return {...elements, Sidebar: elements.Sidebar, SidebarContent: elements.SidebarContent,
      SidebarFooter: elements.SidebarFooter, SidebarHeader: elements.SidebarHeader, useSidebar: () => ({setOpenMobile() {}})};
    if (name.startsWith('@/components/ui/')) return elements;
    if (name.startsWith('@/components/') || name === './project-pane') return new Proxy({}, {get: () => empty});
    throw Error('未提供替身：' + name);
  }, exports);
  return exports;
}
const deferred = () => {let resolve, reject; const promise = new Promise((a, b) => {resolve = a; reject = b}); return {promise, resolve, reject}};
const text = renderer => JSON.stringify(renderer.toJSON());
const button = (renderer, label) => renderer.root.findAllByType('button').find(node => node.children.join('') === label);
const tick = () => new Promise(resolve => setImmediate(resolve));

async function cleanupRetry() {
  const {ManagedProjectPane} = load('components/workbench/managed-project-pane.tsx');
  let project = {id: 'p', available: true, archived: true, snapshot_gc_pending: true};
  api.detail = async () => project;
  api.snapshots = async () => [];
  let calls = 0;
  api.cleanupSnapshots = async id => {
    assert.equal(id, 'p'); calls++;
    project = {...project, snapshot_gc_pending: false, snapshots_cleaned_at: new Date().toISOString()};
  };
  let renderer;
  await act(async () => {renderer = create(React.createElement(ManagedProjectPane, {projectId: 'p'}))});
  await act(async () => button(renderer, '快照').props.onClick());
  assert.equal(button(renderer, '重试清理快照').props.disabled, false);
  assert.ok(text(renderer).includes('残留对象尚未清理完成'));
  await act(async () => button(renderer, '重试清理快照').props.onClick());
  assert.ok(text(renderer).includes('继续清理残留快照对象'));
  await act(async () => button(renderer, '确认清理快照').props.onClick());
  assert.equal(calls, 1);
  assert.equal(button(renderer, '清理全部快照').props.disabled, true);
  assert.ok(text(renderer).includes('快照已清理'));
  await act(async () => renderer.unmount());
  for (const blocked of [{occupying_session_id: 'busy'}, {file_operation: {kind: 'restore', state: 'failed'}}]) {
    project = {id: 'p', available: true, archived: true, snapshot_gc_pending: true, ...blocked};
    await act(async () => {renderer = create(React.createElement(ManagedProjectPane, {projectId: 'p'}))});
    await act(async () => button(renderer, '快照').props.onClick());
    assert.equal(button(renderer, '重试清理快照').props.disabled, true);
    await act(async () => renderer.unmount());
  }
  console.log('PASS: 空快照列表待回收可确认重试，成功后禁用；运行/文件占用仍禁止清理');
}

async function pickerRace(fail) {
  const {ProjectPicker} = load('components/project-picker.tsx');
  const late = deferred(), archived = deferred();
  api.list = (isArchived, offset = 0) => isArchived ? archived.promise : offset ? late.promise : Promise.resolve({projects: [{id: 'active', name: '活动项目'}], total: 51});
  let renderer;
  await act(async () => {renderer = create(React.createElement(ProjectPicker, {open: true, onSelect() {}}))});
  await act(async () => {button(renderer, '加载更多').props.onClick()});
  await act(async () => button(renderer, '已归档').props.onClick());
  assert.ok(!text(renderer).includes('活动项目'));
  await act(async () => {if (fail) late.reject(Error('旧分页失败')); else late.resolve({projects: [{id: 'late', name: '迟到活动项目'}], total: 51})});
  assert.ok(text(renderer).includes('正在读取'));
  assert.ok(!text(renderer).includes('迟到活动项目') && !text(renderer).includes('旧分页失败'));
  await act(async () => archived.resolve({projects: [{id: 'archived', name: '归档项目'}], total: 1}));
  assert.ok(text(renderer).includes('归档项目') && !text(renderer).includes('加载更多'));
  await act(async () => renderer.unmount());
  console.log(`PASS: 切换归档后旧分页${fail ? '失败' : '成功'}不污染列表、总数或当前加载状态`);
}

async function pickerReopen() {
  const {ProjectPicker} = load('components/project-picker.tsx');
  const late = deferred();
  let initial = 0;
  api.list = (_archived, offset = 0) => offset ? late.promise : Promise.resolve({projects: [{id: 'p', name: ++initial === 1 ? '第一次列表' : '重新打开列表'}], total: 51});
  let renderer;
  const props = {onSelect() {}};
  await act(async () => {renderer = create(React.createElement(ProjectPicker, {...props, open: true}))});
  await act(async () => {button(renderer, '加载更多').props.onClick()});
  await act(async () => renderer.update(React.createElement(ProjectPicker, {...props, open: false})));
  await act(async () => renderer.update(React.createElement(ProjectPicker, {...props, open: true})));
  await act(async () => late.resolve({projects: [{id: 'late', name: '关闭前旧分页'}], total: 52}));
  assert.ok(text(renderer).includes('重新打开列表') && !text(renderer).includes('关闭前旧分页'));
  await act(async () => renderer.unmount());
  console.log('PASS: 关闭/重开选择器使旧分页失效');
}

async function selectedOutsidePage() {
  const {LeftPanel} = load('components/left-panel.tsx');
  workspace.projects = Array.from({length: 50}, (_, index) => ({id: `p${index}`, name: `项目${index}`, available: true}));
  workspace.total = 51;
  const project = {id: 'outside', name: '分页外项目', available: true};
  const selected = {session_id: 'current', title: '分页外当前对话', project};
  pathname = '/sessions/current';
  sessionApi.getSession = async () => selected;
  api.sessions = async () => ({sessions: [{session_id: 'recent', title: '最近对话'}], total: 2});
  let renderer;
  await act(async () => {renderer = create(React.createElement(LeftPanel)); await tick()});
  let nav = renderer.root.findByType('nav').props;
  const row = nav.projects.find(value => value.id === 'outside');
  assert.ok(row);
  assert.equal(nav.projects[0].id, 'outside');
  assert.ok(row.conversations.some(value => value.session_id === 'current'));
  assert.equal(workspace.projects.length, 50);
  const collapsed = {...nav.expansion, items: {...nav.expansion.items, outside: false}};
  await act(async () => nav.onExpansion(collapsed));
  await act(async () => renderer.update(React.createElement(LeftPanel)));
  nav = renderer.root.findByType('nav').props;
  assert.equal(nav.expansion.items.outside, false);
  // 列表读取失败时也保留已有的当前对话，错误不冒充空列表。
  api.sessions = async () => {throw Error('对话列表断连')};
  await act(async () => nav.onExpansion({...nav.expansion, items: {...nav.expansion.items, outside: true}}));
  nav = renderer.root.findByType('nav').props;
  const failed = nav.projects.find(value => value.id === 'outside');
  assert.ok(failed.conversations.some(value => value.session_id === 'current'));
  assert.equal(failed.navigationError, '对话列表断连');
  await act(async () => renderer.unmount());
  // 直接打开分页外项目：按 id 定位，不拉取所有分页，也不创建会话。
  pathname = '/projects/direct';
  api.detail = async id => ({id, name: '直接打开的项目', available: true});
  await act(async () => {renderer = create(React.createElement(LeftPanel)); await tick()});
  nav = renderer.root.findByType('nav').props;
  assert.ok(nav.projects.some(value => value.id === 'direct'));
  pathname = '/';
  await act(async () => renderer.update(React.createElement(LeftPanel)));
  assert.ok(!renderer.root.findByType('nav').props.projects.some(value => value.id === 'direct'));
  await act(async () => renderer.unmount());
  console.log('PASS: 当前项目/对话跨分页可见，列表断连保留选中项，用户折叠不被刷新重置，离开路由移除临时定位');
}

async function main() {
  await cleanupRetry();
  await pickerRace(false); await pickerRace(true); await pickerReopen();
  await selectedOutsidePage();
}
main().catch(error => {console.error(error); process.exitCode = 1});
