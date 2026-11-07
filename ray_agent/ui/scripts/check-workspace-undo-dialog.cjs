/* eslint-disable @typescript-eslint/no-require-imports */
// 挂载真实的提示条、最近修改与撤销窗口；仅替换网络、订阅和基础 UI。
const assert = require('node:assert/strict');
const React = require('react');
const {create, act} = require('react-test-renderer');
const {createLoader} = require('./workspace-loader.cjs');
global.IS_REACT_ACT_ENVIRONMENT = true;
const element = (type = 'div') => props => React.createElement(type, props, props.children);
const ui = new Proxy({}, {get: () => element()});
let root, props;
let live = {change: {signal: 0}, requestRefresh: () => {
  live = {...live, change: {signal: live.change.signal + 1}};
  root.update(React.createElement(Harness, props));
}};
const entry = {root_id: 'root', relative_path: 'note.txt', operation: 'modify', writes: 1,
  first_at: 1, last_at: 2, before: null, after: null, current: null,
  status: 'undoable', conflict_reason: null, can_force: false, preview_kind: 'restore'};
let changes = {run_id: 'run', session_id: 'session', session_title: '任务', run_active: false, entries: [entry]};
let runs = [{run_id: 'run', session_id: 'session', session_title: '任务', run_status: 'completed', kind: 'run', changed_files: 1}];
const historyApi = {
  runChanges: async (_workspace, id) => ({...changes, run_id: id, entries: id === 'undo' ? [entry] : changes.entries}),
  undo: async (_workspace, id) => {
    changes = {...changes, entries: [{...entry, status: id === 'undo' ? 'undoable' : 'restored'}]};
    runs = [{...runs[0], run_id: id === 'undo' ? 'undo-2' : 'undo', kind: 'undo'}, ...runs];
    return [{relative_path: 'note.txt', status: 'restored', message: '已恢复', current: null, can_force: false}];
  },
};
const load = createLoader({
  'lucide-react': new Proxy({}, {get: () => () => null}),
  '@/lib/api/workspace': {historyApi},
  '@/lib/api/fetch': {ApiError: class extends Error {}},
  '@/hooks/use-session-title': {useSessionTitle: () => '任务'},
  '@/providers/workspace-live-provider': {useWorkspaceLive: () => live},
  '@/lib/navigation': {Link: element('a')},
  '@/lib/utils': {cn: (...values) => values.filter(Boolean).join(' '), formatRelativeDate: () => '刚才'},
  '@/components/ui/button': {Button: element('button')},
  '@/components/ui/scroll-area': ui,
  '@/components/ui/skeleton': ui,
  '@/components/ui/dialog': {...ui, Dialog: ({open, children}) => open ? React.createElement('section', {role: 'dialog'}, children) : null,
    DialogContent: element(), DialogHeader: element(), DialogTitle: element('h2'), DialogDescription: element(), DialogFooter: element()},
});
const {RunChangesBar} = load('src/components/workspace/run-changes-bar.tsx');
const {RecentChanges} = load('src/components/workspace/recent-changes.tsx');
function Harness({workspace, runId = 'run'}) {
  return React.createElement(React.Fragment, null,
    React.createElement(RunChangesBar, {workspace, runId}),
    React.createElement(RecentChanges, {workspaceId: workspace.id, runs}));
}
const text = node => typeof node === 'string' ? node : (node?.children ?? []).map(text).join('');
const click = async label => {
  const buttons = root.root.findAllByType('button').filter(button => text(button) === label);
  assert.equal(buttons.length, 1, label);
  await act(async () => buttons[0].props.onClick());
};
const dialogs = () => root.root.findAllByProps({role: 'dialog'});
async function main() {
  props = {workspace: {id: 'w', status: 'active', folder: {status: 'available'}}};
  await act(async () => {root = create(React.createElement(Harness, props));});
  await click('撤销本次修改');
  await click('撤销所选（1）');
  assert.equal(dialogs().length, 1, '提示条消失后仍显示同一个操作结果');
  assert.match(text(dialogs()[0]), /已处理 1 项/);
  assert.equal(root.root.findAllByType('button').filter(button => text(button) === '撤销本次修改').length, 0);
  await click('完成');
  assert.equal(dialogs().length, 0);
  await click('撤回');
  assert.equal(dialogs().length, 1, '从最近修改打开时没有旧窗口叠出');
  assert.match(text(dialogs()[0]), /撤回这次撤销/);
  await click('撤回所选（1）');
  assert.equal(dialogs().length, 1, '撤回后原运行再次可撤销，也不复活旧窗口');
  assert.match(text(dialogs()[0]), /已处理 1 项/);
  await click('完成');
  changes = {...changes, entries: [entry]};
  runs = [{run_id: 'undo', session_id: 'session', session_title: '任务', run_status: 'completed', kind: 'undo', changed_files: 1},
    {run_id: 'run', session_id: 'session', session_title: '任务', run_status: 'completed', kind: 'run', changed_files: 1}];
  await act(async () => live.requestRefresh());
  assert.equal(dialogs().length, 0, '文件重新可撤销时不会复活旧窗口');
  await click('撤销本次修改');
  await click('撤回');
  assert.equal(dialogs().length, 1, '另一个入口打开时关掉运行底部的窗口');
  assert.match(text(dialogs()[0]), /撤回这次撤销/);
  await click('取消');
  assert.equal(dialogs().length, 0);
  await click('撤销本次修改');
  await act(async () => {props = {workspace: {...props.workspace, status: 'archived'}}; root.update(React.createElement(Harness, props));});
  assert.equal(dialogs().length, 0);
  await act(async () => {props = {workspace: {...props.workspace, status: 'active'}}; root.update(React.createElement(Harness, props));});
  assert.equal(dialogs().length, 0, '重新可写后不重新打开旧窗口');
  await click('撤销本次修改');
  await act(async () => {props = {...props, runId: 'another-run'}; root.update(React.createElement(Harness, props));});
  assert.equal(dialogs().length, 0, '运行切换后不沿用旧窗口');
  await act(async () => root.unmount());
  console.log('PASS: 撤销结果不随提示条消失、最近修改不叠窗、权限和运行切换清理旧窗口');
}
main().catch(error => {console.error(error); process.exitCode = 1;});
