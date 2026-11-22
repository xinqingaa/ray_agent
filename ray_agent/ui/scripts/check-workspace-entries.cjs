/* eslint-disable @typescript-eslint/no-require-imports */
// 文件夹条目操作：名称规则、操作集合、版本、失败文案（纯逻辑），以及挂载真实的文件树、就地输入与删除确认（替身基础 UI）。
const assert = require('node:assert/strict');
const React = require('react');
const {create, act} = require('react-test-renderer');
const {createLoader} = require('./workspace-loader.cjs');
global.IS_REACT_ACT_ENVIRONMENT = true;

async function main() {
  const element = (type = 'div') => props => React.createElement(type, props, props.children);
  const ui = new Proxy({}, {get: () => element()});
  const captured = [];
  const load = createLoader({
    '@/components/ui/icons': new Proxy({}, {get: () => () => null}),
    '@/components/ui/button': {Button: element('button')},
    '@/components/ui/input': {Input: props => React.createElement('input', props)},
    '@/components/ui/context-menu': {
      // 行表面的菜单项（去掉分隔线）；带 items 的表面渲染子节点
      ContextMenuSurface: ({items, children}) => {captured.push(typeof items === 'function' ? [] : items.filter(item => item.type === 'item')); return children},
    },
    '@/components/run/file-icon': {fileExtension: () => '', FileTypeBadge: element('span')},
    '@/components/run/format': {formatBytes: () => '3 B'},
    '@/lib/platform': {fileManagerName: () => 'Finder'},
    '@/lib/utils': {cn: (...values) => values.filter(Boolean).join(' ')},
    '@/components/ui/dialog': {...ui, Dialog: ({open, children}) => open ? React.createElement('section', {role: 'dialog'}, children) : null,
      DialogContent: element(), DialogHeader: element(), DialogTitle: element('h2'), DialogDescription: element(), DialogFooter: element()},
    // 删除确认经由危险确认弹框（真实组件，基础的 AlertDialog 替身）
    '@/components/ui/alert-dialog': {AlertDialog: ({open, children}) => open ? React.createElement('section', {role: 'alertdialog'}, children) : null,
      AlertDialogContent: element(), AlertDialogHeader: element(), AlertDialogTitle: element('h2'), AlertDialogDescription: element('p'), AlertDialogFooter: element()},
  });
  const pure = load('src/lib/workspace-entries.ts');
  const {FolderTree} = load('src/components/workspace/folder-tree.tsx');
  const {DeleteEntryDialog} = load('src/components/workspace/delete-entry-dialog.tsx');

  // —— 名称规则（与核心一致的界面预检）
  assert.equal(pure.entryNameError('  新建  '), null);
  assert.match(pure.entryNameError('.') ?? '', /不能为空/);
  assert.match(pure.entryNameError('a/b') ?? '', /\//);
  assert.match(pure.entryNameError('a\\b') ?? '', /\\/);
  assert.match(pure.entryNameError('a\u0007b') ?? '', /控制字符/);
  assert.match(pure.entryNameError('.rayagent') ?? '', /保留/);
  assert.match(pure.entryNameError('x'.repeat(256)) ?? '', /255/);
  assert.equal(pure.entryNameError('y'.repeat(255)), null);
  assert.match(pure.entryNameError('中'.repeat(86)) ?? '', /255/, '多字节按 UTF-8 字节计算');
  assert.deepEqual(pure.checkRenameName('note.txt', 'note.txt'), {ok: true, name: 'note.txt', changed: false});
  assert.deepEqual(pure.checkRenameName('note.txt', ' next.txt '), {ok: true, name: 'next.txt', changed: true});
  assert.equal(pure.checkNewName('').ok, false);
  assert.deepEqual(pure.renameSelection('report.final.pdf'), [0, 12]);
  assert.deepEqual(pure.renameSelection('README'), [0, 6]);
  assert.deepEqual(pure.renameSelection('.env'), [0, 4], '以点开头的名称不把整个名拆成扩展名');

  // —— 操作集合与版本
  assert.deepEqual(pure.entryActionsFor('file'), {rename: true, remove: true, createFolder: false});
  assert.deepEqual(pure.entryActionsFor('directory'), {rename: false, remove: true, createFolder: true});
  assert.deepEqual(pure.entryActionsFor('symlink'), {rename: false, remove: false, createFolder: false});
  assert.deepEqual(pure.entryVersionOf({kind: 'file', name: 'a', size: 3, modified_ns: '17'}), {size: 3, modified_ns: '17'});
  assert.equal(pure.entryVersionOf({kind: 'file', name: 'a', size: null, modified_ns: '17'}), null);
  assert.equal(pure.entryVersionOf({kind: 'directory', name: 'd', size: null, modified_ns: null}), null);

  // —— 失败文案：租约占用说明占用者；冲突与其他错误保留核心消息
  const lease = {state: 'active', owner_session_id: 's1'};
  const leaseText = pure.entryFailureText({code: 'conflict', message: 'x', details: {lease}}, () => '任务甲');
  assert.match(leaseText, /任务甲/);
  assert.equal(pure.entryFailureText({code: 'conflict', message: '同名已存在', details: null}, () => null), '同名已存在');
  assert.equal(pure.entryFailureText({code: 'invalid_request', message: '名称没有变化', details: null}, () => null), '名称没有变化');

  // —— 文件树：就地改名、根与展开目录里的新建草稿、行菜单
  const tree = {
    directories: {
      '': {status: 'ready', truncated: false, entries: [
        {name: 'docs', kind: 'directory', size: null, modified_ns: null},
        {name: 'note.txt', kind: 'file', size: 3, modified_ns: '17'},
      ]},
      docs: {status: 'ready', truncated: false, entries: []},
    },
    expanded: ['docs'],
  };
  const noop = () => {};
  const baseProps = {tree, selectedPath: null, onSelect: noop, onToggle: noop, onRetry: noop, editBusy: false,
    onEditChange: noop, onEditCommit: noop, onEditCancel: noop, onStartRename: noop, onStartCreate: noop, onRequestDelete: noop,
    onReveal: noop, onAdd: noop, onCopyPath: noop};
  const inputs = root => root.root.findAllByType('input');
  const label = node => node.props['aria-label'];

  let rendered;
  captured.length = 0;
  act(() => {rendered = create(React.createElement(FolderTree, {...baseProps, edit: {kind: 'create', directory: '', draft: ''}}));});
  let drafts = inputs(rendered).filter(node => label(node) === '新文件夹名称');
  assert.equal(drafts.length, 1, '根目录的新建草稿只出现一次');
  assert.ok(captured.length > 0, '行菜单已渲染');

  const fileMenu = captured.find(actions => actions.some(action => action.label === '重命名'));
  assert.ok(fileMenu, '文件行有重命名');
  assert.deepEqual(fileMenu.map(action => action.label), ['预览', '添加文件到所在目录', '在 Finder 中显示', '复制路径', '重命名', '删除']);
  assert.equal(fileMenu.find(action => action.label === '删除').destructive, true);
  const dirMenu = captured.find(actions => actions.some(action => action.label === '新建文件夹'));
  assert.deepEqual(dirMenu.map(action => action.label), ['添加文件到此目录', '新建文件夹', '在 Finder 中显示', '复制路径', '删除']);
  assert.ok(!dirMenu.some(action => action.label === '预览' || action.label === '重命名'), '文件夹不预览、不改名');

  // 草稿输入：回车提交、Escape 取消、失焦交给调用方
  const calls = [];
  const handlers = {onEditChange: draft => calls.push(['change', draft]), onEditCommit: fromBlur => calls.push(['commit', fromBlur]), onEditCancel: () => calls.push(['cancel'])};
  act(() => {rendered.update(React.createElement(FolderTree, {...baseProps, ...handlers, edit: {kind: 'create', directory: '', draft: '新'}}));});
  drafts = inputs(rendered).filter(node => label(node) === '新文件夹名称');
  assert.equal(drafts[0].props.value, '新');
  act(() => drafts[0].props.onChange({target: {value: '新文件夹'}}));
  const keyDown = key => ({key, nativeEvent: {isComposing: false}, preventDefault: noop, stopPropagation: noop});
  act(() => drafts[0].props.onKeyDown(keyDown('Enter')));
  act(() => drafts[0].props.onKeyDown(keyDown('Escape')));
  act(() => drafts[0].props.onBlur());
  assert.deepEqual(calls, [['change', '新文件夹'], ['commit', false], ['cancel'], ['commit', true]]);

  // 展开的 docs 下出现草稿，且只出现一次
  act(() => {rendered.update(React.createElement(FolderTree, {...baseProps, edit: {kind: 'create', directory: 'docs', draft: ''}}));});
  assert.equal(inputs(rendered).filter(node => label(node) === '新文件夹名称').length, 1);

  // 改名：文件行替换为输入框，并带当前名称；错误留在输入框下方
  const noteEntry = tree.directories[''].entries[1];
  act(() => {rendered.update(React.createElement(FolderTree, {...baseProps, edit: {kind: 'rename', path: 'note.txt', entry: noteEntry, draft: 'next.txt', error: '名称不能包含 / 或 \\'}}));});
  const renameInput = inputs(rendered).find(node => label(node) === '重命名 note.txt');
  assert.ok(renameInput, '重命名输入框出现');
  assert.equal(renameInput.props.value, 'next.txt');
  assert.equal(renameInput.props['aria-invalid'], true);
  assert.ok(rendered.root.findAll(node => node.props.role === 'alert' && typeof node.props.children === 'string' && node.props.children.includes('不能包含')).length === 1, '错误说明出现');
  act(() => {rendered.update(React.createElement(FolderTree, {...baseProps, edit: null}));});
  assert.equal(inputs(rendered).length, 0, '结束编辑后没有输入框');

  // —— 删除确认：取消在前，确认为破坏性样式；提交失败留在弹框里显示说明
  let deleted = null;
  let closed = 0;
  let dialog;
  act(() => {dialog = create(React.createElement(DeleteEntryDialog, {
    target: {path: 'note.txt', entry: noteEntry}, onClose: () => closed++,
    onConfirm: async target => {deleted = target.path; throw new Error('文件已被修改，请刷新后再试')},
  }));});
  assert.ok(dialog.root.findAll(node => node.props.role === 'alertdialog').length === 1, '删除确认弹框打开');
  const buttons = dialog.root.findAllByType('button').map(node => node.props.children);
  assert.deepEqual(buttons.flat().filter(Boolean), ['取消', '删除'], '取消在前');
  await act(async () => {dialog.root.findAllByType('button')[1].props.onClick();});
  assert.equal(deleted, 'note.txt');
  assert.equal(closed, 0, '失败时弹框不关闭');
  assert.ok(dialog.root.findAll(node => node.props.role === 'alert').length === 1, '失败说明显示在弹框内');
  console.log('check-workspace-entries: 通过');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
