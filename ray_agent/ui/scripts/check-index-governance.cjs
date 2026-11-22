/* eslint-disable @typescript-eslint/no-require-imports */
// 工作区索引范围与权限治理：纯逻辑分类／策略切换 + FolderTree 文件与目录右键索引开关。
const assert = require('node:assert/strict');
const React = require('react');
const {create, act} = require('react-test-renderer');
const {createLoader} = require('./workspace-loader.cjs');
global.IS_REACT_ACT_ENVIRONMENT = true;

const element = (type = 'div') => props => React.createElement(type, props, props.children);
const captured = [];
const load = createLoader({
  '@/components/ui/icons': new Proxy({}, {get: () => () => null}),
  '@/components/ui/button': {Button: element('button')},
  '@/components/ui/input': {Input: props => React.createElement('input', props)},
  '@/components/ui/context-menu': {
    ContextMenuSurface: ({items, children}) => {
      captured.push(typeof items === 'function' ? [] : items.filter(item => item.type === 'item'));
      return children;
    },
  },
  '@/components/run/file-icon': {fileExtension: () => '', FileTypeBadge: element('span')},
  '@/components/run/format': {formatBytes: () => '3 B'},
  '@/lib/platform': {fileManagerName: () => 'Finder'},
  '@/lib/utils': {cn: (...values) => values.filter(Boolean).join(' ')},
});

const policyMod = load('src/lib/document-index-policy.ts');
const {FolderTree} = load('src/components/workspace/folder-tree.tsx');

// —— 纯逻辑：4 类内容识别
assert.equal(policyMod.categoryForPath('report.pdf'), 'documents');
assert.equal(policyMod.categoryForPath('slides.pptx'), 'documents');
assert.equal(policyMod.categoryForPath('notes/a.md'), 'documents');
assert.equal(policyMod.categoryForPath('budget.xlsx'), 'spreadsheets');
assert.equal(policyMod.categoryForPath('data.csv'), 'spreadsheets');
assert.equal(policyMod.categoryForPath('scan.png'), 'images');
assert.equal(policyMod.categoryForPath('build_ppt.py'), 'code');
assert.equal(policyMod.categoryForPath('page.html'), 'code');
assert.equal(policyMod.categoryForPath('app.log'), 'code');
assert.equal(policyMod.categoryForPath('config.ini'), 'code');
assert.equal(policyMod.categoryForPath('.env.example'), 'code');
assert.equal(policyMod.categoryForPath('archive.zip'), null);
assert.equal(policyMod.categoryForPath('Makefile'), null);

const baseSummary = {
  policy: {
    version: 1,
    paused: false,
    excluded_directories: ['drafts'],
    excluded_files: ['muted.md'],
    included_files: ['drafts/pinned.md'],
    enabled_categories: ['documents', 'spreadsheets', 'images'],
    agent_outputs: 'manual',
    scope_confirmed: true,
  },
  scan: {
    files: 2,
    bytes: 100,
    excluded_files: 1,
    excluded_bytes: 50,
    directories: [],
    directory_sizes: {},
    excluded_directory_sizes: {},
    pending_outputs: ['slides.pptx'],
    category_skipped: 1,
    truncated: false,
  },
};

// —— 纯逻辑：单文件／目录判定与策略变换
assert.deepEqual(policyMod.fileIndexAction('guide.md', baseSummary), {kind: 'exclude'});
assert.deepEqual(policyMod.fileIndexAction('muted.md', baseSummary), {kind: 'include', needsExplicitInclude: false});
assert.deepEqual(policyMod.fileIndexAction('build_ppt.py', baseSummary), {kind: 'include', needsExplicitInclude: true});
assert.deepEqual(policyMod.fileIndexAction('slides.pptx', baseSummary), {kind: 'include', needsExplicitInclude: true});
assert.deepEqual(policyMod.fileIndexAction('drafts/other.md', baseSummary), {kind: 'include', needsExplicitInclude: true});
assert.deepEqual(policyMod.fileIndexAction('drafts/pinned.md', baseSummary), {kind: 'exclude'});
assert.equal(policyMod.fileIndexAction('archive.zip', baseSummary), null);
assert.equal(policyMod.directoryIndexAction('drafts', baseSummary), 'include');
assert.equal(policyMod.directoryIndexAction('notes', baseSummary), 'exclude');

const norm = policyMod.normalizePolicy(baseSummary.policy);
const excludedPinned = policyMod.excludeFile(norm, 'drafts/pinned.md');
assert.ok(excludedPinned.excluded_files.includes('drafts/pinned.md'));
assert.ok(!excludedPinned.included_files.includes('drafts/pinned.md'), '排除时同步移出 included_files');

const includedScript = policyMod.includeFile(norm, 'build_ppt.py', true);
assert.ok(includedScript.included_files.includes('build_ppt.py'));

const excludedDir = policyMod.excludeDirectory(norm, 'drafts');
assert.ok(!excludedDir.included_files.includes('drafts/pinned.md'), '排除目录同步清理其下旧的显式纳入');

const withCode = policyMod.toggleCategory(norm, 'code', true);
assert.deepEqual(withCode.enabled_categories, ['documents', 'spreadsheets', 'images', 'code']);
assert.equal(policyMod.samePolicy(norm, withCode), false);
assert.equal(policyMod.setAgentOutputs(norm, 'auto').agent_outputs, 'auto');

// —— FolderTree 右键菜单：按文件状态显示「从索引排除 / 纳入索引」，未知格式不出现
const tree = {
  directories: {
    '': {
      status: 'ready',
      truncated: false,
      entries: [
        {name: 'drafts', kind: 'directory', size: null, modified_ns: null},
        {name: 'notes', kind: 'directory', size: null, modified_ns: null},
        {name: 'guide.md', kind: 'file', size: 10, modified_ns: '1'},
        {name: 'slides.pptx', kind: 'file', size: 20, modified_ns: '2'},
        {name: 'build_ppt.py', kind: 'file', size: 30, modified_ns: '3'},
        {name: 'archive.zip', kind: 'file', size: 40, modified_ns: '4'},
      ],
    },
  },
  expanded: [],
};
const toggled = [];
const noop = () => {};
captured.length = 0;
act(() => {
  create(React.createElement(FolderTree, {
    tree,
    selectedPath: null,
    indexSummary: baseSummary,
    indexStates: new Map([['guide.md', 'searchable']]),
    onSelect: noop,
    onToggle: noop,
    onRetry: noop,
    onToggleFileIndex: p => toggled.push(['file', p]),
    onToggleDirectoryIndex: d => toggled.push(['dir', d]),
  }));
});

assert.equal(captured.length, 6, '6 个条目均有行菜单');
const [draftsMenu, notesMenu, guideMenu, slidesMenu, scriptMenu, zipMenu] = captured;
assert.ok(draftsMenu.some(item => item.label === '恢复目录索引'));
assert.ok(notesMenu.some(item => item.label === '从索引排除此目录'));
assert.ok(guideMenu.some(item => item.label === '从索引排除'));
assert.ok(slidesMenu.some(item => item.label === '纳入索引'));
assert.ok(scriptMenu.some(item => item.label === '纳入索引'));
assert.ok(!zipMenu.some(item => item.label.includes('索引')), '不支持格式不显示索引开关');

slidesMenu.find(item => item.label === '纳入索引').run();
notesMenu.find(item => item.label === '从索引排除此目录').run();
assert.deepEqual(toggled, [['file', 'slides.pptx'], ['dir', 'notes']]);

console.log('PASS: 工作区索引四类内容分类、策略切换、优先级与文件树就地索引菜单');
