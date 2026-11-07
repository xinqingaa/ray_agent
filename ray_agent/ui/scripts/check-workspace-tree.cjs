/* eslint-disable @typescript-eslint/no-require-imports */
// 文件树数据合并：懒加载、刷新保留展开、已消失目录的剪枝、特殊条目不展开、添加文件的目标目录。
const assert = require('node:assert/strict');
const {createLoader} = require('./workspace-loader.cjs');

const t = createLoader()('src/lib/workspace-tree.ts');
const entry = (name, kind = 'file', extra = {}) => ({path: {root_id: 'r', relative_path: name}, name, kind, size: kind === 'file' ? 1 : null, modified_at: null, link_target: null, ...extra});
const listing = (...entries) => ({path: {root_id: 'r', relative_path: ''}, entries, truncated: false});
const names = (tree) => t.visibleRows(tree).map((row) => row.kind === 'entry' ? `${'  '.repeat(row.depth)}${row.entry.name}` : `${'  '.repeat(row.depth)}<${row.state}>`);

// 初始：只有根目录待读取，显示读取中
let tree = t.EMPTY_TREE;
assert.deepEqual(t.pendingDirectories(tree), ['']);
assert.deepEqual(names(tree), ['<loading>']);
tree = t.beginLoad(tree, '');
assert.deepEqual(t.pendingDirectories(tree), [], '已在读取的目录不重复请求');

// 排序：目录在前，自然序（数字按大小），中文名可比较
tree = t.applyListing(tree, '', listing(entry('b.txt'), entry('src', 'directory'), entry('a10.md'), entry('a2.md'), entry('docs', 'directory'), entry('link', 'symlink', {link_target: '../x'}), entry('sock', 'other')));
assert.deepEqual(names(tree), ['docs', 'src', 'a2.md', 'a10.md', 'b.txt', 'link', 'sock']);
assert.equal(t.visibleRows(tree).find((row) => row.entry?.name === 'link').expandable, false, '符号链接不展开');
assert.equal(t.visibleRows(tree).find((row) => row.entry?.name === 'sock').expandable, false, '特殊文件不展开');
assert.equal(t.visibleRows(tree).find((row) => row.entry?.name === 'src').path, 'src');

// 展开子目录：先显示读取中，读到后合并进去；其他目录不受影响
tree = t.setExpanded(tree, 'src', true);
assert.deepEqual(t.pendingDirectories(tree), ['src']);
assert.deepEqual(names(tree).slice(0, 4), ['docs', 'src', '  <loading>', 'a2.md']);
tree = t.beginLoad(tree, 'src');
tree = t.applyListing(tree, 'src', listing(entry('lib', 'directory'), entry('main.ts')));
tree = t.setExpanded(tree, 'src/lib', true);
tree = t.beginLoad(tree, 'src/lib');
tree = t.applyListing(tree, 'src/lib', listing());
assert.deepEqual(names(tree).slice(0, 6), ['docs', 'src', '  lib', '    <empty>', '  main.ts', 'a2.md']);
assert.equal(t.visibleRows(tree).find((row) => row.entry?.name === 'main.ts').path, 'src/main.ts');

// 刷新时已有内容不被清空（不闪动）；失败保留旧内容并给出错误行，可重试
const refreshed = t.beginLoad(tree, 'src');
assert.equal(refreshed, tree);
const failed = t.applyError(tree, 'src', '读取目录失败');
assert.ok(names(failed).includes('  <error>'));
assert.ok(names(failed).includes('  main.ts'), '失败后旧内容仍在');
const firstFailure = t.applyError(t.beginLoad(t.EMPTY_TREE, ''), '', '拒绝访问');
assert.deepEqual(names(firstFailure), ['<error>']);

// 刷新根目录后 src 被删除：连同子目录缓存与展开状态一起剪掉；保留的目录不受影响
const gone = t.pruneMissing(t.applyListing(tree, '', listing(entry('docs', 'directory'), entry('b.txt'))), '');
assert.deepEqual(gone.expanded, []);
assert.deepEqual(Object.keys(gone.directories), ['']);
assert.deepEqual(t.pendingDirectories(gone), []);
// 目录仍在则保留展开与缓存
const kept = t.pruneMissing(t.applyListing(tree, '', listing(entry('src', 'directory'))), '');
assert.deepEqual([...kept.expanded].sort(), ['src', 'src/lib']);
assert.ok(kept.directories['src/lib']);
// 子目录内某个子目录被删除只剪那一支
const trimmed = t.pruneMissing(t.applyListing(tree, 'src', listing(entry('main.ts'))), 'src');
assert.deepEqual(trimmed.expanded, ['src']);
assert.equal(trimmed.directories['src/lib'], undefined);

// 收起父目录同时收起其后代，再展开时后代不自动展开
const collapsed = t.setExpanded(tree, 'src', false);
assert.deepEqual(collapsed.expanded, []);
assert.deepEqual(names(collapsed).slice(0, 3), ['docs', 'src', 'a2.md']);

// 目录过大：显示截断提示，仍显示已读到的条目
const big = t.applyListing(t.EMPTY_TREE, '', {...listing(entry('x.txt')), truncated: true});
assert.deepEqual(names(big), ['x.txt', '<truncated>']);
assert.deepEqual(names(t.applyListing(t.EMPTY_TREE, '', listing())), ['<empty>']);

// 添加文件的目标：没有选择为根；选目录为该目录；选文件为其所在目录
assert.equal(t.uploadTarget(null), '');
assert.equal(t.uploadTarget({path: 'src', kind: 'directory'}), 'src');
assert.equal(t.uploadTarget({path: 'src/lib/a.ts', kind: 'file'}), 'src/lib');
assert.equal(t.uploadTarget({path: 'top.txt', kind: 'file'}), '');
assert.equal(t.joinPath('', 'a'), 'a');
assert.equal(t.joinPath('a/b', 'c'), 'a/b/c');

console.log('workspace tree checks passed');
