/* eslint-disable @typescript-eslint/no-require-imports */
// 危险确认弹框：挂载真实的 DangerConfirmDialog（Radix AlertDialog 与按钮），检查焦点默认在取消、确认为危险样式、
// 提交中 Esc／遮罩／取消都不能关闭、失败说明留在弹框内、成功后关闭。DOM 替身见 dom-env.cjs。
const assert = require('node:assert/strict');
const React = require('react');
const {setupDom} = require('./dom-env.cjs');
const {createLoader} = require('./workspace-loader.cjs');

const {window, document, act, flush, createRoot} = setupDom();
const load = createLoader({});
const {DangerConfirmDialog} = load('src/components/ui/danger-confirm-dialog.tsx');

function mount(overrides) {
  const calls = [];
  const props = {
    open: true,
    title: '永久删除这段对话？',
    description: '对话历史与附件将永久删除，无法恢复。',
    confirmLabel: '永久删除对话',
    busyLabel: '正在删除',
    onConfirm: async () => {},
    onOpenChange: value => calls.push(value),
    ...overrides,
  };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {root.render(React.createElement(DangerConfirmDialog, props));});
  // 与父组件一样：收到 onOpenChange(false) 后由父组件改为关闭
  const setOpen = value => act(() => {root.render(React.createElement(DangerConfirmDialog, {...props, open: value}));});
  return {calls, root, container, setOpen};
}

const dialogNode = () => document.querySelector('[role="alertdialog"]');
const buttonNamed = text => Array.from(document.querySelectorAll('[role="alertdialog"] button')).find(node => node.textContent === text);
const alertText = () => document.querySelector('[role="alertdialog"] [role="alert"]')?.textContent ?? null;

function dispose(dialog) {
  act(() => {dialog.root.unmount();});
}

function escape() {
  act(() => {document.dispatchEvent(new window.KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));});
}

function pointerDownOnOverlay() {
  const overlay = document.querySelector('[data-slot="alert-dialog-overlay"]');
  assert.ok(overlay, '遮罩存在');
  act(() => {overlay.dispatchEvent(new window.Event('pointerdown', {bubbles: true}));});
}

async function main() {
  // —— 焦点默认在取消，取消写在确认之前，确认为危险样式
  {
    const dialog = mount({});
    await flush(2);
    assert.ok(dialogNode(), '弹框打开');
    assert.equal(document.activeElement, buttonNamed('取消'), '焦点默认在取消');
    const labels = Array.from(document.querySelectorAll('[role="alertdialog"] button')).map(node => node.textContent);
    assert.deepEqual(labels, ['取消', '永久删除对话'], '取消在前，确认在后');
    assert.match(buttonNamed('永久删除对话').className, /bg-destructive/, '确认按钮为危险样式');
    assert.equal(dialog.calls.length, 0);
    dispose(dialog);
  }

  // —— 空闲时 Esc 与取消都关闭（只发出 false）
  {
    const dialog = mount({});
    await flush(2);
    escape();
    assert.deepEqual(dialog.calls, [false], '空闲时 Esc 关闭');
    dispose(dialog);
  }
  {
    const dialog = mount({});
    await flush(2);
    act(() => buttonNamed('取消').click());
    assert.deepEqual(dialog.calls, [false], '空闲时取消关闭');
    dispose(dialog);
  }

  // —— 提交中不可关闭；失败说明留在弹框内；随后可以再次取消
  {
    let rejectFirst;
    let attempts = 0;
    const dialog = mount({
      onConfirm: () => {
        attempts++;
        return new Promise((_, reject) => {rejectFirst = reject;});
      },
    });
    await flush(2);
    await act(async () => {buttonNamed('永久删除对话').click();});
    assert.ok(buttonNamed('正在删除'), '提交中确认按钮显示进行文字');
    assert.equal(buttonNamed('取消').disabled, true, '提交中取消禁用');
    escape();
    pointerDownOnOverlay();
    assert.deepEqual(dialog.calls, [], '提交中 Esc 与遮罩都不能关闭');
    assert.ok(dialogNode(), '提交中弹框仍然打开');

    await act(async () => {rejectFirst(new Error('对话正在运行，请先停止后再删除'));});
    await flush(2);
    assert.equal(alertText(), '对话正在运行，请先停止后再删除', '失败说明显示在弹框内');
    assert.deepEqual(dialog.calls, [], '失败后弹框不关闭');
    assert.ok(buttonNamed('永久删除对话'), '失败后可以重试');
    assert.equal(buttonNamed('取消').disabled, false, '失败后取消可用');
    assert.equal(attempts, 1);

    act(() => buttonNamed('取消').click());
    assert.deepEqual(dialog.calls, [false], '失败后可以取消');
    dispose(dialog);
  }

  // —— 成功：弹框关闭，不显示说明
  {
    let resolveFirst;
    const dialog = mount({onConfirm: () => new Promise(resolve => {resolveFirst = resolve;})});
    await flush(2);
    await act(async () => {buttonNamed('永久删除对话').click();});
    await act(async () => {resolveFirst();});
    await flush(2);
    assert.deepEqual(dialog.calls, [false], '成功后关闭');
    assert.equal(alertText(), null, '成功后没有说明');
    dispose(dialog);
  }

  // —— 非 Error 的失败使用通用说明
  {
    const dialog = mount({onConfirm: async () => {throw 'boom'}});
    await flush(2);
    await act(async () => {buttonNamed('永久删除对话').click();});
    await flush(2);
    assert.equal(alertText(), '操作失败，请重试', '未知失败使用通用说明');
    dispose(dialog);
  }

  // —— 关闭后焦点回到指定位置
  {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    let restored = 0;
    const dialog = mount({onRestoreFocus: () => {restored++; opener.focus();}});
    await flush(2);
    escape();
    dialog.setOpen(false);
    await flush(3);
    assert.equal(restored, 1, '关闭后调用恢复焦点');
    assert.equal(document.activeElement, opener, '焦点回到原处');
    dispose(dialog);
    opener.remove();
  }

  console.log('check-danger-dialog: 通过');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
