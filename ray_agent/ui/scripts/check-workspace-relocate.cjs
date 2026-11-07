/* eslint-disable @typescript-eslint/no-require-imports */
// 重新定位失败的文案映射：按核心 409 的 details 区分原因，400/403/410/404 各有说明，未知错误保留核心原文。
const assert = require('node:assert/strict');
const {createLoader} = require('./workspace-loader.cjs');

const {describeRelocateError: describe} = createLoader()('src/lib/workspace-relocate.ts');
const context = {
  workspaces: [{id: 'w-other', name: '资料库'}],
  titleOf: (id) => (id === 's1' ? '整理报告' : null),
};
const error = (code, message, details = {}) => ({code, message, details});

// 目标已绑定：有名字时指出是哪个工作区，没有名字不编造
let result = describe(error('conflict', 'x', {reason: 'already_bound', workspace_id: 'w-other'}), context);
assert.match(result.message, /已经绑定到工作区「资料库」/);
assert.equal(result.refresh, false);
assert.match(describe(error('conflict', 'x', {reason: 'already_bound', workspace_id: 'unknown'}), context).message, /已经绑定到另一个工作区/);

// 标记属于本机另一个工作区
assert.match(describe(error('conflict', 'x', {reason: 'marker_other_workspace', workspace_name: '旧项目'}), context).message, /「旧项目」的标记/);
assert.match(describe(error('conflict', 'x', {reason: 'marker_other_workspace'}), context).message, /另一个工作区的标记/);

// 写入租约：带占用者；读不到标题时只说“另一个对话”
result = describe(error('conflict', 'x', {lease: {state: 'held', owner_session_id: 's1', writer_kind: 'core_tool', operation: null, reason: ''}}), context);
assert.match(result.message, /暂时不能重新定位.*对话「整理报告」正在写入/);
assert.match(describe(error('conflict', 'x', {lease: {state: 'held', owner_session_id: 's9'}}), context).message, /另一个对话正在写入/);
assert.match(describe(error('conflict', 'x', {lease: {state: 'blocked', owner_session_id: 's1'}}), context).message, /重试收尾/);
assert.match(describe(error('conflict', 'x', {lease: {state: 'held', owner_session_id: ''}}), context).message, /添加文件/);

// 活动运行
result = describe(error('conflict', 'x', {session_id: 's1', run_id: 'r1'}), context);
assert.match(result.message, /正在运行/);
assert.equal(result.refresh, false);

// 没有原因字段的 409 是版本不符：提示已刷新并要求刷新工作区
result = describe(error('conflict', '工作区已被修改，请刷新后重试'), context);
assert.match(result.message, /刚在别处被修改/);
assert.equal(result.refresh, true);

// 目标文件夹本身不能用（嵌套、数据根、系统目录）：带上核心给出的原因
for (const code of ['forbidden', 'invalid_request', 'validation_failed']) {
  assert.equal(describe(error(code, '不能选择系统目录'), context).message, '不能使用所选文件夹：不能选择系统目录', code);
}

// 授权失效、工作区不存在
assert.match(describe(error('gone', '文件夹授权已过期，请重新选择文件夹'), context).message, /重新点击“重新定位”/);
result = describe(error('not_found', '工作区不存在'), context);
assert.match(result.message, /已经不存在/);
assert.equal(result.refresh, true);

// 其他错误保留原文；不是错误对象也不抛异常
assert.deepEqual(describe(error('unavailable', '核心暂时不可用'), context), {message: '核心暂时不可用', refresh: false});
assert.deepEqual(describe(new Error('无法连接核心'), context), {message: '无法连接核心', refresh: false});
assert.deepEqual(describe('boom', context), {message: '重新定位失败', refresh: false});
assert.deepEqual(describe(null, context), {message: '重新定位失败', refresh: false});

console.log('workspace relocate checks passed');
