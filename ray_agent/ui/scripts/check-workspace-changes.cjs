/* eslint-disable @typescript-eslint/no-require-imports */
// 外部变更合并与去抖、受影响目录、预览提示、写入租约提示，以及撤销的默认选择、force 组装与结果合并。
const assert = require('node:assert/strict');
const {createLoader} = require('./workspace-loader.cjs');

const c = createLoader()('src/lib/workspace-changes.ts');
const changed = (paths, refresh = false) => ({kind: 'changed', paths, refresh});

// ---- 合并：路径去重保序，整体刷新吞掉路径，非 changed 事件不进入批次
let batch = c.EMPTY_BATCH;
assert.equal(c.mergeChange(batch, {kind: 'ready', paths: [], refresh: false}), batch);
assert.equal(c.mergeChange(batch, {kind: 'availability', paths: ['a'], refresh: true}), batch);
batch = c.mergeChange(batch, changed(['a.txt', 'src/b.ts']));
batch = c.mergeChange(batch, changed(['src/b.ts', 'c.md']));
assert.deepEqual(batch, {paths: ['a.txt', 'src/b.ts', 'c.md'], refresh: false}, '重复报告只算一次');
assert.equal(c.mergeChange(batch, changed(['a.txt'])), batch, '没有新增路径时返回原批次');
batch = c.mergeChange(batch, changed([], true));
assert.deepEqual(batch, {paths: [], refresh: true}, 'refresh 清掉路径');
assert.equal(c.mergeChange(batch, changed(['x'])), batch, '整体刷新之后的路径不再累计');
assert.equal(c.isEmptyBatch(c.EMPTY_BATCH), true);
assert.equal(c.isEmptyBatch(batch), false);

// ---- 受影响目录：只读变化条目所在的已读取目录；refresh 全部重读
assert.equal(c.parentDirectory('a.txt'), '');
assert.equal(c.parentDirectory('src/lib/x.ts'), 'src/lib');
const loaded = ['', 'src', 'src/lib', 'docs'];
assert.deepEqual(c.directoriesToReload({paths: ['a.txt'], refresh: false}, loaded), ['']);
assert.deepEqual(c.directoriesToReload({paths: ['src/lib/x.ts', 'docs/y.md'], refresh: false}, loaded), ['src/lib', 'docs']);
assert.deepEqual(c.directoriesToReload({paths: ['unread/deep/z.ts'], refresh: false}, loaded), [], '没读过的目录不读取');
assert.deepEqual(c.directoriesToReload({paths: ['src/new'], refresh: false}, loaded), ['src'], '新目录靠父目录发现');
assert.deepEqual(c.directoriesToReload({paths: [], refresh: true}, loaded), loaded);

// ---- 预览文件被改动
assert.equal(c.touchesFile({paths: ['a.txt'], refresh: false}, 'a.txt'), true);
assert.equal(c.touchesFile({paths: ['a.txt'], refresh: false}, 'b.txt'), false);
assert.equal(c.touchesFile({paths: [], refresh: true}, 'a.txt'), false, '整体刷新无法判断具体文件');

// ---- 去抖收集器：注入调度器，不依赖真实时钟
function fakeClock() {
  const timers = new Map();
  let next = 1;
  return {
    timers,
    schedule: (callback, delay) => {const id = next++; timers.set(id, {callback, delay}); return id;},
    cancel: (id) => timers.delete(id),
    fire: () => {const [id, timer] = [...timers][0]; timers.delete(id); timer.callback();},
  };
}
{
  const clock = fakeClock();
  const flushed = [];
  const collector = c.createChangeCollector({delay: 300, flush: (b) => flushed.push(b), schedule: clock.schedule, cancel: clock.cancel});
  collector.push(changed(['a']));
  collector.push(changed(['b']));
  collector.push(changed(['a']));
  assert.equal(clock.timers.size, 1, '窗口内只有一个定时器，每次新通知重新计时');
  assert.equal([...clock.timers.values()][0].delay, 300);
  assert.equal(flushed.length, 0);
  clock.fire();
  assert.deepEqual(flushed, [{paths: ['a', 'b'], refresh: false}]);
  collector.push({kind: 'ready', paths: [], refresh: false});
  assert.equal(clock.timers.size, 0, '非 changed 事件不触发刷新');
  collector.push(changed([], true));
  collector.push(changed(['c']));
  clock.fire();
  assert.deepEqual(flushed[1], {paths: [], refresh: true}, '窗口内出现 refresh 就整体刷新');
  collector.flushNow();
  assert.equal(flushed.length, 2, '没有累计内容时 flushNow 不交出空批次');
  collector.push(changed(['d']));
  collector.flushNow();
  assert.deepEqual(flushed[2], {paths: ['d'], refresh: false}, 'flushNow 立即交出并取消定时器');
  assert.equal(clock.timers.size, 0);
  collector.push(changed(['e']));
  collector.dispose();
  assert.equal(clock.timers.size, 0);
  assert.equal(flushed.length, 3, '退订后不再交出');
}

// ---- 写入租约提示
const lease = (extra = {}) => ({id: 'l1', state: 'held', writer_kind: 'core_tool', owner_session_id: 's-other', owner_run_id: 'r1', operation: null, reason: 'write_file', acquired_at: 1, updated_at: 1, ...extra});
assert.equal(c.leaseNotice(null, 's1'), null);
assert.deepEqual(c.leaseNotice(lease(), 's1'), {kind: 'writing', own: false});
assert.equal(c.leaseNotice(lease({owner_session_id: 's1'}), 's1'), null, '自己的会话正常写入不打扰');
assert.deepEqual(c.leaseNotice(lease({state: 'preparing'}), null), {kind: 'writing', own: false}, '工作区首页没有当前会话');
assert.deepEqual(c.leaseNotice(lease({state: 'settling'}), 's1'), {kind: 'settling', own: false});
assert.deepEqual(c.leaseNotice(lease({state: 'blocked', owner_session_id: 's1'}), 's1'), {kind: 'blocked', own: true}, '阻止状态自己的也要能重试收尾');
assert.deepEqual(c.leaseNotice(lease({owner_session_id: ''}), 's1'), {kind: 'writing', own: false}, '没有会话的写入（添加文件）算别人的');
assert.equal(c.leaseFromDetails({}), null);
assert.equal(c.leaseFromDetails(undefined), null);
assert.deepEqual(c.leaseFromDetails({lease: {state: 'held', owner_session_id: 's9', writer_kind: 'core_tool', operation: 'x', reason: 'r', acquired_at: 1}}),
  {state: 'held', owner_session_id: 's9', writer_kind: 'core_tool', operation: 'x', reason: 'r'});
assert.match(c.leaseConflictText({state: 'held', owner_session_id: 's9'}, '整理报告'), /对话「整理报告」正在写入/);
assert.match(c.leaseConflictText({state: 'held', owner_session_id: 's9'}, null), /^另一个对话正在写入/, '读不到标题时不编造');
assert.match(c.leaseConflictText({state: 'held', owner_session_id: ''}, null), /添加文件/);
assert.match(c.leaseConflictText({state: 'settling', owner_session_id: 's9'}, 'T'), /正在停止/);
assert.match(c.leaseConflictText({state: 'blocked', owner_session_id: 's9'}, 'T'), /重试收尾/);

// ---- 撤销：默认选择、勾选规则、force 组装
const version = (size, modified_ns) => ({size, modified_ns: String(modified_ns), sha256: null});
const entry = (path, extra = {}) => ({
  root_id: 'r', relative_path: path, operation: 'modify', writes: 1, first_at: 1, last_at: 2,
  before: version(1, 10), after: version(2, 20), current: version(2, 20), status: 'undoable', conflict_reason: null,
  can_force: false, preview_kind: 'restore', ...extra,
});
const entries = [
  entry('a.txt'),
  entry('new.md', {operation: 'create', before: null, preview_kind: 'remove'}),
  entry('moved.txt', {status: 'conflict', conflict_reason: 'modified', can_force: true, current: version(9, 99)}),
  entry('gone.txt', {status: 'conflict', conflict_reason: 'missing', can_force: true, current: null}),
  entry('made.md', {operation: 'create', before: null, status: 'conflict', conflict_reason: 'modified', can_force: false, preview_kind: 'remove', current: version(5, 50)}),
  entry('same.txt', {status: 'restored', current: version(1, 10)}),
];
let selection = c.initialSelection(entries);
assert.deepEqual([...selection.selected], ['a.txt', 'new.md'], '只默认选中可直接撤销的；冲突与已恢复不选');
assert.equal(selection.forced.size, 0);
assert.deepEqual(c.buildUndoItems(entries, selection), [{relative_path: 'a.txt'}, {relative_path: 'new.md'}], '直接撤销不带 force');

assert.equal(c.setSelected(selection, entries[5], true), selection, '已是运行前状态的不能选');
assert.equal(c.setSelected(selection, entries[4], true), selection, 'can_force 为假的冲突不能勾选');
selection = c.setSelected(selection, entries[2], true);
assert.deepEqual([...selection.forced], ['moved.txt'], '勾选冲突项即“仍要覆盖”');
selection = c.setSelected(selection, entries[3], true);
const items = c.buildUndoItems(entries, selection);
assert.deepEqual(items.map((item) => item.relative_path), ['a.txt', 'new.md', 'moved.txt', 'gone.txt'], '按条目顺序提交');
assert.deepEqual(items[2].force, {exists: true, size: 9, modified_ns: '99'}, 'force 原样带上界面看到的当前版本');
assert.deepEqual(items[3].force, {exists: false, size: null, modified_ns: null}, '文件已不存在时 exists 为假');
assert.equal(items[0].force, undefined);
selection = c.setSelected(selection, entries[2], false);
assert.equal(selection.forced.has('moved.txt'), false);
assert.equal(c.buildUndoItems(entries, selection).some((item) => item.relative_path === 'moved.txt'), false, '取消后不提交');
selection = c.setSelected(selection, entries[0], false);
assert.equal(c.buildUndoItems(entries, selection).some((item) => item.relative_path === 'a.txt'), false);
// 冲突项被选中但没有 force 标记（不应出现）也不会无保护地提交
assert.deepEqual(c.buildUndoItems([entries[2]], {selected: new Set(['moved.txt']), forced: new Set()}), []);
assert.deepEqual(c.buildUndoItems([entries[4]], {selected: new Set(['made.md']), forced: new Set(['made.md'])}), [], '不允许 force 的冲突项永不提交');

// ---- 提交结果：冲突再覆盖、合并、汇总
const result = (path, status, extra = {}) => ({relative_path: path, status, message: '', current: null, conflict_reason: null, can_force: false, ...extra});
const first = [
  result('a.txt', 'restored'),
  result('new.md', 'removed'),
  result('moved.txt', 'conflict', {conflict_reason: 'modified', can_force: true, current: version(10, 100)}),
  result('made.md', 'conflict', {conflict_reason: 'modified', can_force: false, current: version(5, 50)}),
  result('x.txt', 'failed', {message: '权限不足'}),
  result('same.txt', 'unchanged'),
];
assert.deepEqual(c.summarizeResults(first), {done: 2, unchanged: 1, conflicts: 2, failed: 1});
assert.deepEqual(c.forceRetryItem(first[2]), {relative_path: 'moved.txt', force: {exists: true, size: 10, modified_ns: '100'}}, '再次覆盖用结果里返回的最新版本');
const precise = JSON.parse('{"size":10,"modified_ns":"1770000000123456789","sha256":null}');
assert.equal(JSON.parse(JSON.stringify(c.forceRetryItem(result('precise.txt', 'conflict', {can_force: true, current: precise})))).force.modified_ns,
  '1770000000123456789', '真实纳秒量级的版本经 JSON 往返与覆盖重试不丢精度');
assert.equal(c.forceRetryItem(first[3]), null, '不允许 force 的冲突没有再覆盖');
assert.equal(c.forceRetryItem(first[0]), null);
assert.equal(c.forceRetryItem(first[4]), null);
const merged = c.mergeResults(first, [result('moved.txt', 'restored'), result('extra.txt', 'restored')]);
assert.deepEqual(merged.map((r) => `${r.relative_path}:${r.status}`),
  ['a.txt:restored', 'new.md:removed', 'moved.txt:restored', 'made.md:conflict', 'x.txt:failed', 'same.txt:unchanged', 'extra.txt:restored'], '同路径以最新为准，顺序保持');

// ---- 入口条件
assert.equal(c.undoAvailable(null), false);
assert.equal(c.undoAvailable({run_active: true, entries}), false, '运行进行中没有撤销入口');
assert.equal(c.undoAvailable({run_active: false, entries: []}), false);
assert.equal(c.undoAvailable({run_active: false, entries: [entries[5]]}), false, '都已是运行前状态也没有入口');
assert.equal(c.undoAvailable({run_active: false, entries}), true);
assert.equal(c.undoAvailable({run_active: false, entries: [entries[2]]}), true, '只有冲突项时仍可进入处理');
assert.equal(c.runStillActive('running'), true);
assert.equal(c.runStillActive('waiting'), true);
assert.equal(c.runStillActive('completed'), false);
assert.equal(c.runStillActive('unknown'), false);

console.log('workspace changes checks passed');
