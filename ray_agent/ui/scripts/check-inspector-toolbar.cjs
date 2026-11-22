/* eslint-disable @typescript-eslint/no-require-imports */
// 工作台顶栏操作溢出：纯函数宽度计算 + 真实 TaskInspectorTabs 与 FolderToolbarActions 组件。
const assert = require('node:assert/strict');
const React = require('react');
const {setupDom} = require('./dom-env.cjs');
const {createLoader} = require('./workspace-loader.cjs');

const {window, document, act, flush, createRoot} = setupDom();

// 轻量 ResizeObserver 替身：测试可按需触发宽度变化
const observers = new Set();
window.ResizeObserver = class {
  constructor(callback) { this.callback = callback; this.targets = new Set(); }
  observe(target) { this.targets.add(target); observers.add(this); }
  unobserve(target) { this.targets.delete(target); }
  disconnect() { this.targets.clear(); observers.delete(this); }
};
global.ResizeObserver = window.ResizeObserver;

function triggerResize() {
  for (const observer of observers) observer.callback([], observer);
}

function setClientWidth(node, width) {
  Object.defineProperty(node, 'clientWidth', {configurable: true, value: width});
}

// DropdownMenu 替身：点击触发器切换展开，菜单项触发 onSelect
const MenuContext = React.createContext({open: false, setOpen() {}});
const dropdownStub = {
  DropdownMenu({children}) {
    const [open, setOpen] = React.useState(false);
    return React.createElement(MenuContext.Provider, {value: {open, setOpen}}, children);
  },
  DropdownMenuTrigger({children}) {
    const {open, setOpen} = React.useContext(MenuContext);
    return React.cloneElement(children, {
      'data-state': open ? 'open' : 'closed',
      onClick: () => setOpen(v => !v),
    });
  },
  DropdownMenuContent({children}) {
    const {open} = React.useContext(MenuContext);
    return open ? React.createElement('div', {role: 'menu'}, children) : null;
  },
  DropdownMenuItem({children, disabled, onSelect}) {
    const {setOpen} = React.useContext(MenuContext);
    return React.createElement('button', {
      type: 'button', role: 'menuitem', disabled,
      onClick: () => { if (!disabled) { onSelect?.(); setOpen(false); } },
    }, children);
  },
};

const iconActionStub = {
  IconAction: React.forwardRef(function IconAction({label, children, ...props}, ref) {
    return React.createElement('button', {type: 'button', 'aria-label': label, ref, ...props}, children);
  }),
};

const load = createLoader({
  '@/components/ui/dropdown-menu': dropdownStub,
  '@/components/ui/icon-action': iconActionStub,
});

const {visibleToolbarActionCount, FolderToolbarActions} = load('src/components/workspace/folder-toolbar-actions.tsx');
const {TaskInspectorTabs} = load('src/components/task-layout.tsx');

// —— 纯函数：宽度边界
assert.equal(visibleToolbarActionCount(3, null), 3, '未测量前展示全部');
assert.equal(visibleToolbarActionCount(3, 88), 3, '刚好容纳 3 个按钮时不溢出');
assert.equal(visibleToolbarActionCount(3, 87), 1, '放不下 3 个时预留 >> 按钮并展示 1 个');
assert.equal(visibleToolbarActionCount(3, 58), 1, '58px 刚好放下 1 个按钮 + >>');
assert.equal(visibleToolbarActionCount(3, 57), 0, '57px 时全部收进 >> 菜单');
assert.equal(visibleToolbarActionCount(3, 0), 0, '容器被挤到 0 宽时全部收进 >> 菜单');
assert.equal(visibleToolbarActionCount(2, 58), 2, '2 个按钮 58px 刚好全部显示');
assert.equal(visibleToolbarActionCount(2, 57), 0, '2 个按钮 57px 时收进 >> 菜单');
assert.equal(visibleToolbarActionCount(1, 28), 1);
assert.equal(visibleToolbarActionCount(1, 20), 0);

async function main() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const calls = [];

  function Harness() {
    const [target, setTarget] = React.useState(null);
    return React.createElement(React.Fragment, null,
      React.createElement(TaskInspectorTabs, {
        value: 'folder', workspace: true, onChange() {}, onClose: () => calls.push('close'), onActions: setTarget,
      }),
      target && require('react-dom').createPortal(
        React.createElement(FolderToolbarActions, {
          directory: '资料',
          collapsible: true,
          revealLabel: '在 Finder 中显示',
          onAdd: () => calls.push('add'),
          onNewFolder: () => calls.push('new-folder'),
          onReveal: () => calls.push('reveal'),
        }),
        target,
      ),
    );
  }

  act(() => { root.render(React.createElement(Harness)); });
  await flush(2);

  const bar = host.querySelector('.task-inspector-tabs');
  const actionsWrap = host.querySelector('[data-toolbar-overflow]') || host.querySelector('.task-inspector-tabs > div:nth-child(2) > div');
  assert.ok(bar && actionsWrap, '顶栏与操作容器已挂载');

  // 宽裕空间（96px）：全部 3 个图标直接可见，没有 >> 溢出入口
  setClientWidth(bar, 320);
  setClientWidth(actionsWrap.parentElement, 96);
  setClientWidth(actionsWrap, 96);
  act(() => triggerResize());
  assert.equal(host.querySelector('[aria-label^="展开其余"]'), null, '空间足够时不显示 >>');
  assert.ok(host.querySelector('[aria-label="添加文件到「资料」"]'));
  assert.ok(host.querySelector('[aria-label="在「资料」中新建文件夹"]'));
  assert.ok(host.querySelector('[aria-label="在 Finder 中显示"]'));
  assert.ok(host.querySelector('[aria-label="收起右侧面板"]'));

  // 窄空间（60px）：保留 1 个图标，其余 2 个收进半透明 >> 溢出菜单
  setClientWidth(bar, 270);
  setClientWidth(actionsWrap.parentElement, 60);
  setClientWidth(actionsWrap, 60);
  act(() => triggerResize());
  assert.ok(host.querySelector('[aria-label="添加文件到「资料」"]'), '首项保持直接可见');
  assert.equal(host.querySelector('[aria-label="在「资料」中新建文件夹"]'), null, '溢出项不在顶栏直接露出');
  const overflowBtn = host.querySelector('[aria-label="展开其余 2 项操作"]');
  assert.ok(overflowBtn, '显示 >> 溢出触发按钮');
  assert.ok(overflowBtn.className.includes('inspector-toolbar-overflow'), '带有半透明溢出样式类');
  assert.ok(host.querySelector('[aria-label="收起右侧面板"]'), '收起按钮始终保持可见');

  // 点击 >> 展开菜单并触发溢出项
  act(() => overflowBtn.click());
  const menuItems = Array.from(host.querySelectorAll('[role="menuitem"]'));
  assert.deepEqual(menuItems.map(n => n.textContent), ['新建文件夹', '在 Finder 中显示']);
  act(() => menuItems[1].click());
  assert.deepEqual(calls, ['reveal']);

  // 极窄空间（36px）：全部 3 项收进 >>，不裁切关闭按钮
  setClientWidth(bar, 260);
  setClientWidth(actionsWrap.parentElement, 36);
  setClientWidth(actionsWrap, 36);
  act(() => triggerResize());
  assert.equal(host.querySelector('[aria-label="添加文件到「资料」"]'), null);
  const overflowAll = host.querySelector('[aria-label="展开其余 3 项操作"]');
  assert.ok(overflowAll, '极窄时全部 3 项收进 >>');
  act(() => overflowAll.click());
  assert.deepEqual(Array.from(host.querySelectorAll('[role="menuitem"]')).map(n => n.textContent),
    ['添加文件', '新建文件夹', '在 Finder 中显示']);

  // 拉宽恢复：全部图标重新直接展示，>> 消失
  setClientWidth(bar, 360);
  setClientWidth(actionsWrap.parentElement, 120);
  setClientWidth(actionsWrap, 120);
  act(() => triggerResize());
  assert.equal(host.querySelector('[aria-label^="展开其余"]'), null, '拉宽后隐藏 >>');
  assert.ok(host.querySelector('[aria-label="在 Finder 中显示"]'));

  act(() => root.unmount());
  host.remove();
  console.log('PASS: 工作台顶栏宽度充足直出、变窄收拢至半透明 >> 菜单、操作可用且拉宽恢复');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
