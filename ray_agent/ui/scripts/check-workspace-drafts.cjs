/* eslint-disable @typescript-eslint/no-require-imports */
// 草稿作用域隔离、清理范围、路由解析与独立对话过滤：执行真实的 drafts / workspace-route / workspace-state 模块。
const assert = require('node:assert/strict');
const {createLoader} = require('./workspace-loader.cjs');

function storage() {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null), setItem: (key, value) => void data.set(key, String(value)),
    removeItem: (key) => void data.delete(key), key: (index) => [...data.keys()][index] ?? null,
    get length() { return data.size; },
  };
}
const events = [];
globalThis.window = {dispatchEvent: (event) => void events.push(event)};
globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
globalThis.sessionStorage = storage();
globalThis.localStorage = storage();

const load = createLoader();
const drafts = load('src/lib/drafts.ts');
const route = load('src/lib/workspace-route.ts');
const state = load('src/lib/workspace-state.ts');

// 三类作用域互不覆盖：独立首页、各工作区首页、具体会话
const {INDEPENDENT_SCOPE, workspaceDraftScope, sessionDraftScope, readDraft, writeDraft, draftClearedBy, applyDataCleared} = drafts;
assert.equal(workspaceDraftScope('w1'), 'workspace:w1');
writeDraft(INDEPENDENT_SCOPE, {text: '独立'});
writeDraft(workspaceDraftScope('w1'), {text: '工作区一', creationId: 'c1'});
writeDraft(workspaceDraftScope('w2'), {text: '工作区二'});
writeDraft(sessionDraftScope('s1'), {text: '会话一'});
assert.equal(readDraft(INDEPENDENT_SCOPE).text, '独立');
assert.equal(readDraft(workspaceDraftScope('w1')).text, '工作区一');
assert.equal(readDraft(workspaceDraftScope('w2')).text, '工作区二');
assert.equal(readDraft(workspaceDraftScope('w2')).creationId, undefined, '创建标识不跨工作区共享');
assert.equal(readDraft(sessionDraftScope('s1')).text, '会话一');

// 清理范围：全部清空，或只清所列工作区与会话
assert.equal(draftClearedBy({id: 'a', scope: 'all', session_ids: []}, INDEPENDENT_SCOPE), true);
const partial = {id: 'b', scope: 'workspace', workspace_ids: ['w1'], session_ids: ['s1']};
assert.equal(draftClearedBy(partial, workspaceDraftScope('w1')), true);
assert.equal(draftClearedBy(partial, sessionDraftScope('s1')), true);
assert.equal(draftClearedBy(partial, workspaceDraftScope('w2')), false);
assert.equal(draftClearedBy(partial, INDEPENDENT_SCOPE), false);
applyDataCleared(partial);
assert.equal(readDraft(workspaceDraftScope('w1')).text, '');
assert.equal(readDraft(sessionDraftScope('s1')).text, '');
assert.equal(readDraft(workspaceDraftScope('w2')).text, '工作区二');
assert.equal(readDraft(INDEPENDENT_SCOPE).text, '独立');

// 路由：工作区首页与工作区内会话；其余路径不属于工作区
assert.deepEqual(route.parseWorkspaceRoute('/workspaces/w1'), {workspaceId: 'w1', sessionId: null});
assert.deepEqual(route.parseWorkspaceRoute('/workspaces/w1/sessions/s9/'), {workspaceId: 'w1', sessionId: 's9'});
assert.deepEqual(route.parseWorkspaceRoute(route.workspaceSessionHref('带 空格/斜杠', 's#1')), {workspaceId: '带 空格/斜杠', sessionId: 's#1'});
for (const other of ['/', '/sessions/s1', '/settings', '/workspaces', '/workspaces/w1/other']) {
  assert.deepEqual(route.parseWorkspaceRoute(other), {workspaceId: null, sessionId: null}, other);
}

// 会话列表的范围参数；工作区状态决定可写性
assert.deepEqual(state.sessionScopeParams(state.sessionScope(null)), {independent: true}, '独立对话由核心过滤');
assert.deepEqual(state.sessionScopeParams(state.sessionScope(undefined)), {independent: true});
assert.deepEqual(state.sessionScopeParams(state.sessionScope('w1')), {workspace_id: 'w1'}, '工作区内只带 workspace_id，不与 independent 同用');
assert.deepEqual(state.sessionScopeParams(undefined), {}, '不传范围时列出全部会话');
const folder = (status) => ({root_id: 'r', path: '/x', status, marker_writable: true, checked_at: 1});
const item = (status, folderStatus) => ({id: 'w', name: 'n', status, version: 1, folder: folderStatus ? folder(folderStatus) : null, created_at: 1, updated_at: 1});
assert.deepEqual(state.describeWorkspace(item('active', 'available')), {label: '可用', archived: false, deleting: false, folderAvailable: true, writable: true});
assert.equal(state.describeWorkspace(item('active', 'unavailable')).label, '不可用');
assert.equal(state.describeWorkspace(item('active', 'unavailable')).writable, false);
assert.equal(state.describeWorkspace(item('archived', 'available')).label, '已归档');
assert.equal(state.describeWorkspace(item('archived', 'available')).writable, false, '归档只读');
assert.equal(state.describeWorkspace(item('active', null)).folderAvailable, false);
assert.deepEqual(state.sortWorkspaces([item('archived', 'available'), {...item('active', 'unavailable'), id: 'u'}, {...item('active', 'available'), id: 'a'}]).map((w) => w.id), ['a', 'u', 'w']);

console.log('workspace drafts/route/state checks passed');
