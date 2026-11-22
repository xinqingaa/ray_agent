/* eslint-disable @typescript-eslint/no-require-imports */
// 全应用右键策略：用 jsdom 挂载真实的 ContextMenuProvider、表面与文本编辑，检查每类位置的 preventDefault、菜单项与执行结果。
// DOM 替身见 dom-env.cjs（布局矩形、contenteditable 判定、execCommand）；真实 WebView 中的选区几何与原生撤销需在宿主窗口走查。
const assert = require('node:assert/strict');
const React = require('react');
const {createLoader} = require('./workspace-loader.cjs');

const {setupDom} = require('./dom-env.cjs');
const {window, document, act, flush, createRoot, execState} = setupDom();

const clipboard = {read: 'XYZ', written: [], readError: null};
const toasts = [];
const load = createLoader({
  '@/lib/platform': {
    isDesktop: () => true,
    readClipboardText: async () => {
      if (clipboard.readError) throw clipboard.readError;
      return clipboard.read;
    },
    writeClipboardText: async text => {clipboard.written.push(text)},
  },
  'sonner': {toast: {error: message => toasts.push(message), message: () => {}}},
});
const {ContextMenuProvider, ContextMenuSurface} = load('src/components/ui/context-menu.tsx');
const {menuItem} = load('src/lib/context-menu-policy.ts');
const {Eye} = load('src/components/ui/icons.tsx');

const opened = [];
const surfaceItems = label => [menuItem(label, Eye, () => {opened.push(label)})];

function Fixture() {
  const [value, setValue] = React.useState('alpha beta');
  return React.createElement(ContextMenuProvider, null,
    React.createElement('main', {id: 'plain'}, React.createElement('p', {id: 'text'}, 'hello world')),
    React.createElement('input', {id: 'field', value, onChange: event => setValue(event.target.value), 'aria-label': '普通输入框'}),
    React.createElement('input', {id: 'readonly', readOnly: true, defaultValue: 'fixed text', 'aria-label': '只读输入框'}),
    React.createElement('input', {id: 'disabled', disabled: true, defaultValue: 'disabled', 'aria-label': '禁用输入框'}),
    React.createElement('input', {id: 'checkbox', type: 'checkbox', 'aria-label': '复选框'}),
    React.createElement('textarea', {id: 'area', defaultValue: 'area text', 'aria-label': '文本域'}),
    React.createElement('div', {id: 'rich', contentEditable: true, suppressContentEditableWarning: true}, 'rich text'),
    React.createElement(ContextMenuSurface, {items: surfaceItems('打开行')},
      React.createElement('div', {id: 'row'}, React.createElement('span', {id: 'row-label'}, 'row'))),
    React.createElement(ContextMenuSurface, {items: surfaceItems('外层'), includeEditing: true},
      React.createElement('div', {id: 'outer'},
        React.createElement(ContextMenuSurface, {items: surfaceItems('内层'), includeEditing: true},
          React.createElement('input', {id: 'nested', defaultValue: 'nested', 'aria-label': '嵌套输入框'})),
        // 没有菜单项的表面透明：右键交给外层
        React.createElement(ContextMenuSurface, {items: () => []},
          React.createElement('span', {id: 'transparent'}, 'transparent')))),
    // 中间元素在 React 里停止冒泡
    React.createElement('div', {id: 'stop-react', onContextMenu: event => event.stopPropagation()},
      React.createElement('span', {id: 'stop-react-child'}, 'stop react')),
    React.createElement('div', {id: 'stop-native'}, React.createElement('span', {id: 'stop-native-child'}, 'stop native')),
    React.createElement(ContextMenuSurface, {items: surfaceItems('禁用表面'), disabled: true},
      React.createElement('div', {id: 'disabled-surface'}, 'disabled surface')),
  );
}

const $ = id => document.getElementById(id);
const menuLabels = () => Array.from(document.querySelectorAll('[role="menu"] [role="menuitem"]')).map(node => node.textContent);
const menuItemNode = label => Array.from(document.querySelectorAll('[role="menuitem"]')).find(node => node.textContent === label);

function contextMenuAt(target, x = 10, y = 10) {
  const event = new window.MouseEvent('contextmenu', {bubbles: true, cancelable: true, clientX: x, clientY: y});
  act(() => {target.dispatchEvent(event);});
  return event;
}

function closeMenu() {
  if (!document.querySelector('[role="menu"]')) return;
  act(() => {document.dispatchEvent(new window.KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));});
}

/** 替身布局矩形：键盘菜单与无坐标的右键按目标底边中点定位 */
function layout(node, box) {
  node.getBoundingClientRect = () => ({left: box.left, top: box.top, width: box.width, height: box.height,
    right: box.left + box.width, bottom: box.top + box.height, x: box.left, y: box.top, toJSON() {}});
}

function anchorPoint() {
  const anchor = document.querySelector('[data-context-menu-anchor]');
  return {left: anchor.style.left, top: anchor.style.top};
}

function select(node, start, end) {
  node.focus();
  node.setSelectionRange(start, end);
}

function selectText(node) {
  const range = document.createRange();
  range.selectNodeContents(node);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

async function clickItem(label) {
  const node = menuItemNode(label);
  assert.ok(node, `菜单项「${label}」存在`);
  await act(async () => {node.click();});
  // 等待焦点恢复（Radix 在卸载后的下一轮事件里恢复）与异步剪贴板读取完成
  await flush();
}

async function main() {
  const container = document.getElementById('root');
  const root = createRoot(container);
  act(() => {root.render(React.createElement(Fixture));});

  // —— 未接入区域：阻止原生菜单，不出现菜单
  let event = contextMenuAt($('text'), 500, 500);
  assert.equal(event.defaultPrevented, true, '未接入区域的右键被阻止');
  assert.deepEqual(menuLabels(), [], '未接入区域无菜单');

  event = contextMenuAt($('disabled-surface'));
  assert.equal(event.defaultPrevented, true, '禁用的表面不接管，但仍阻止原生菜单');
  assert.deepEqual(menuLabels(), [], '禁用的表面无菜单');

  // —— 选中文字（非可编辑）：只给复制
  selectText($('text'));
  event = contextMenuAt($('text'), 10, 10);
  assert.equal(event.defaultPrevented, true, '选中文字区域的右键被阻止');
  assert.deepEqual(menuLabels(), ['复制'], '选中文字只给复制');
  await clickItem('复制');
  assert.deepEqual(clipboard.written, ['hello world'], '复制写入选中的文字');
  window.getSelection().removeAllRanges();

  // 选区不在指针下方时不出现菜单
  selectText($('text'));
  contextMenuAt($('text'), 500, 500);
  assert.deepEqual(menuLabels(), [], '指针不在选区上时不出现菜单');
  window.getSelection().removeAllRanges();

  // —— 可编辑区域：有选区时给剪切、复制、粘贴、全选
  select($('field'), 0, 5);
  event = contextMenuAt($('field'));
  assert.equal(event.defaultPrevented, true, '输入框右键被阻止');
  assert.deepEqual(menuLabels(), ['剪切', '复制', '粘贴', '全选'], '有选区的输入框菜单');
  closeMenu();

  // 无选区：不给剪切与复制
  select($('field'), 3, 3);
  contextMenuAt($('field'));
  assert.deepEqual(menuLabels(), ['粘贴', '全选'], '无选区时不给剪切与复制');
  closeMenu();

  // 只读：没有剪切与粘贴
  select($('readonly'), 0, 5);
  contextMenuAt($('readonly'));
  assert.deepEqual(menuLabels(), ['复制', '全选'], '只读输入框没有剪切与粘贴');
  closeMenu();

  // 禁用的输入框不算可编辑区域：阻止原生菜单，但无菜单
  event = contextMenuAt($('disabled'));
  assert.equal(event.defaultPrevented, true, '禁用输入框的右键被阻止');
  assert.deepEqual(menuLabels(), [], '禁用输入框无菜单');

  // 复选框不是文本输入
  event = contextMenuAt($('checkbox'));
  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(menuLabels(), [], '复选框无文本编辑菜单');

  // 文本域与 contenteditable
  select($('area'), 0, 4);
  contextMenuAt($('area'));
  assert.deepEqual(menuLabels(), ['剪切', '复制', '粘贴', '全选'], '文本域的编辑菜单');
  closeMenu();
  selectText($('rich'));
  event = contextMenuAt($('rich'));
  assert.equal(event.defaultPrevented, true, 'contenteditable 的右键被阻止');
  assert.deepEqual(menuLabels(), ['剪切', '复制', '粘贴', '全选'], 'contenteditable 的编辑菜单');
  closeMenu();
  window.getSelection().removeAllRanges();

  // —— 表面：行表面只给自己的菜单项
  contextMenuAt($('row-label'));
  assert.deepEqual(menuLabels(), ['打开行'], '行表面的菜单');
  closeMenu();

  // —— 嵌套：最内层的表面取胜，外层的菜单不出现
  contextMenuAt($('nested'));
  assert.deepEqual(menuLabels(), ['内层', '粘贴', '全选'], '嵌套输入框取最内层表面，并追加编辑项');
  closeMenu();
  contextMenuAt($('outer'));
  assert.deepEqual(menuLabels(), ['外层'], '外层表面的空白区域只给外层菜单');
  closeMenu();

  // 表面菜单优先于编辑菜单：表面 items 在前，编辑项在分隔线之后
  selectText($('outer'));
  select($('nested'), 0, 6);
  contextMenuAt($('nested'));
  assert.deepEqual(menuLabels(), ['内层', '剪切', '复制', '粘贴', '全选'], '表面项在前，编辑项在后');
  closeMenu();
  window.getSelection().removeAllRanges();

  // —— 执行：粘贴经剪贴板封装读取，插入后受控输入收到变化
  select($('field'), 6, 10);
  clipboard.read = 'XYZ';
  contextMenuAt($('field'));
  await clickItem('粘贴');
  assert.equal($('field').value, 'alpha XYZ', '粘贴替换选区，受控输入的值同步');
  assert.deepEqual(execState.calls, ['XYZ'], '粘贴走可撤销的 insertText');

  // 剪切：复制到剪贴板并删除选区
  select($('field'), 0, 6);
  contextMenuAt($('field'));
  await clickItem('剪切');
  assert.deepEqual(clipboard.written.at(-1), 'alpha ', '剪切写入剪贴板');
  assert.equal($('field').value, 'XYZ', '剪切删除选区');

  // 全选：选中整个输入框
  select($('field'), 0, 0);
  contextMenuAt($('field'));
  await clickItem('全选');
  assert.equal($('field').selectionStart, 0);
  assert.equal($('field').selectionEnd, $('field').value.length, '全选覆盖整个输入框');

  // 回退路径：execCommand 不可用时直接写值，仍然同步受控输入
  execState.supported = false;
  select($('field'), 0, 0);
  clipboard.read = '!';
  contextMenuAt($('field'));
  await clickItem('粘贴');
  assert.equal($('field').value, '!XYZ', '不支持 execCommand 时回退为直接写值');
  execState.supported = true;

  // 剪贴板读取失败：说明以中文提示，内容不变
  clipboard.readError = new Error('剪贴板里没有文字');
  select($('field'), 0, 0);
  const before = $('field').value;
  contextMenuAt($('field'));
  await clickItem('粘贴');
  assert.equal($('field').value, before, '读取失败时内容不变');
  assert.deepEqual(toasts.at(-1), '无法读取剪贴板里的文字，请重试', '读取失败有中文提示');
  clipboard.readError = null;

  // —— 表面项执行：关闭后执行
  contextMenuAt($('row-label'));
  await clickItem('打开行');
  assert.deepEqual(opened, ['打开行'], '表面项在菜单关闭后执行');

  // 关闭菜单后焦点回到右键前的输入框
  select($('field'), 0, 0);
  $('field').focus();
  contextMenuAt($('field'));
  closeMenu();
  await flush(3);
  assert.equal(document.activeElement, $('field'), 'Esc 关闭后焦点回到输入框');

  // —— 捕获阶段兜底：中间元素停止冒泡（React 或原生）时，仍然阻止原生菜单，也不生成菜单
  event = contextMenuAt($('stop-react-child'));
  assert.equal(event.defaultPrevented, true, 'React 中间元素停止冒泡时仍阻止原生菜单');
  assert.deepEqual(menuLabels(), [], 'React 中间元素停止冒泡后没有菜单');
  $('stop-native').addEventListener('contextmenu', ev => ev.stopPropagation());
  event = contextMenuAt($('stop-native-child'));
  assert.equal(event.defaultPrevented, true, '原生中间元素停止冒泡时仍阻止原生菜单');
  assert.deepEqual(menuLabels(), [], '原生中间元素停止冒泡后没有菜单');

  // 没有菜单项的表面透明：右键交给外层表面
  contextMenuAt($('transparent'));
  assert.deepEqual(menuLabels(), ['外层'], '透明表面把右键交给外层');
  closeMenu();

  // —— 键盘菜单键：菜单贴着目标底边中点打开，不在窗口原点
  layout($('row-label'), {left: 100, top: 50, width: 40, height: 20});
  act(() => {$('row-label').dispatchEvent(new window.KeyboardEvent('keydown', {key: 'ContextMenu', bubbles: true, cancelable: true}));});
  assert.deepEqual(menuLabels(), ['打开行'], '键盘菜单键打开表面菜单');
  assert.deepEqual(anchorPoint(), {left: '120px', top: '70px'}, '表面的键盘菜单贴着目标底边中点');
  closeMenu();

  // 无坐标的右键（键盘触发的 contextmenu）按可编辑目标的底边中点定位
  layout($('field'), {left: 200, top: 300, width: 100, height: 30});
  select($('field'), 0, 3);
  act(() => {$('field').dispatchEvent(new window.MouseEvent('contextmenu', {bubbles: true, cancelable: true, clientX: 0, clientY: 0}));});
  assert.deepEqual(menuLabels(), ['剪切', '复制', '粘贴', '全选'], '无坐标的右键打开编辑菜单');
  assert.deepEqual(anchorPoint(), {left: '250px', top: '330px'}, '编辑菜单贴着输入框底边中点，不在窗口原点');
  closeMenu();

  act(() => {root.unmount();});
  console.log('check-context-menu: 通过');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
