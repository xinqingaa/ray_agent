/* eslint-disable @typescript-eslint/no-require-imports */
// 分段控件滑块：挂载实际的 SettingsSegment、SegmentedControl（含 icons 模式）与顶栏 WorkspaceViewNav，
// 检查滑块贴合选中项（aria-checked / aria-selected / aria-current="page"）的位置与尺寸、
// 切换选中后跟随、字号缩放（尺寸变化）后重新测量，没有选中项时不显示滑块，以及动效只使用 token 并尊重减少动态效果。
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const React = require('react');
const {setupDom} = require('./dom-env.cjs');
const {createLoader} = require('./workspace-loader.cjs');

const root = path.resolve(__dirname, '..');
const {window, document, act, createRoot} = setupDom();

// 字号系数：影响按钮与链接的文字宽度（与 --font-scale 的效果一致）。
let scale = 1;
const SEGMENT_HEIGHT = 30;
const isSegmentItem = node => node.tagName === 'BUTTON' || node.tagName === 'A';
const itemsOf = node => Array.from(node.parentElement?.children ?? []).filter(isSegmentItem);
const widthOf = node => Math.round(node.textContent.length * 14 * scale + 20);
Object.defineProperty(window.HTMLElement.prototype, 'offsetWidth', {
  configurable: true,
  get() {return isSegmentItem(this) ? widthOf(this) : 0;},
});
Object.defineProperty(window.HTMLElement.prototype, 'offsetHeight', {
  configurable: true,
  get() {return isSegmentItem(this) ? SEGMENT_HEIGHT : 0;},
});
Object.defineProperty(window.HTMLElement.prototype, 'offsetTop', {configurable: true, get() {return 0;}});
Object.defineProperty(window.HTMLElement.prototype, 'offsetLeft', {
  configurable: true,
  get() {
    if (!isSegmentItem(this)) return 0;
    const items = itemsOf(this);
    const index = items.indexOf(this);
    return items.slice(0, index).reduce((sum, item) => sum + widthOf(item) + 2, 0);
  },
});

const observers = [];
global.ResizeObserver = class {
  constructor(callback) {this.callback = callback; observers.push(this);}
  observe() {}
  unobserve() {}
  disconnect() {this.callback = null;}
};
const fireResize = () => act(() => {observers.forEach(item => item.callback?.());});

const load = createLoader({
  './settings-row.css': {},
  '@/lib/navigation': {
    Link: ({href, children, ...props}) => React.createElement('a', {href, ...props}, children),
    usePathname: () => '/',
  },
  '@/components/ui/sidebar': {useSidebar: () => ({open: true, isMobile: false, openMobile: false, toggleSidebar() {}})},
  '@/components/ui/icon-action': {IconAction: ({label, children, ...props}) => React.createElement('button', {'aria-label': label, ...props}, children)},
  './data-cleanup-notice': {DataCleanupNotice: () => null},
  './workspace/workspace-deletion-notice': {WorkspaceDeletionNotice: () => null},
  './conversation-search': {ConversationSearch: () => null},
  '@/providers/workspaces-provider': {useWorkspace: () => ({phase: 'loading'})},
  '@/providers/workspace-pending': {useWorkspacePending: () => ({count: 0})},
  '@/hooks/use-sessions': {useSessions: () => ({sessions: []})},
});
const {SettingsSegment} = load('src/components/settings/settings-row.tsx');
const {SegmentedControl} = load('src/components/ui/segmented-control.tsx');
const {WorkspaceViewNav} = load('src/components/sidebar-chrome.tsx');

const $ = selector => document.querySelector(selector);
const thumbOf = group => group.querySelector(':scope > span[aria-hidden="true"]');
const selectedItem = group => group.querySelector(':scope > [aria-checked="true"], :scope > [aria-selected="true"], :scope > [aria-current="page"]');
// jsdom 会省略值为 0px 的第二个分量（translate(12px)），这里按缺省为 0 解析。
const parseTransform = value => {
  const match = /translate\((-?[\d.]+)px(?:, (-?[\d.]+)px)?\)/.exec(value ?? '');
  return match ? {left: Number(match[1]), top: Number(match[2] ?? 0)} : null;
};

function mount(element) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {root.render(element);});
  return {
    rerender: next => {act(() => {root.render(next);});},
    unmount: () => {
      act(() => {root.unmount();});
      container.remove();
    },
  };
}

const SETTINGS_OPTIONS = [{value: 'a', label: '浅色'}, {value: 'b', label: '深色'}, {value: 'c', label: '跟随系统'}];
const TABS_OPTIONS = [{value: 'a', label: '全部'}, {value: 'b', label: '已安装'}, {value: 'c', label: '技能市场'}];

function SettingsHarness({initial}) {
  const [value, setValue] = React.useState(initial);
  return React.createElement(SettingsSegment, {label: '外观', value, options: SETTINGS_OPTIONS, onChange: setValue});
}

function TabsHarness({initial, appearance = 'full'}) {
  const [value, setValue] = React.useState(initial);
  return React.createElement(SegmentedControl, {label: '视图', value, onValueChange: setValue, options: TABS_OPTIONS, appearance});
}

function checkThumbPlacement(name, group, expectedText) {
  const thumb = thumbOf(group);
  assert.ok(thumb, `${name}：选中项存在时显示滑块`);
  const selected = selectedItem(group);
  assert.ok(selected, `${name}：存在选中项`);
  assert.equal(selected.textContent, expectedText, `${name}：选中项是 ${expectedText}`);
  const position = parseTransform(thumb.style.transform);
  assert.ok(position, `${name}：滑块用 transform 定位`);
  assert.equal(position.left, selected.offsetLeft, `${name}：滑块的横向位置贴合选中项`);
  assert.equal(thumb.style.width, `${selected.offsetWidth}px`, `${name}：滑块宽度贴合选中项`);
  assert.equal(thumb.style.height, `${selected.offsetHeight}px`, `${name}：滑块高度贴合选中项`);
}

function selectedOf(group, label) {
  return Array.from(group.querySelectorAll(':scope > button')).find(node => node.textContent === label);
}

function checkSettingsSegment() {
  scale = 1;
  let view = mount(React.createElement(SettingsHarness, {initial: 'b'}));
  const group = $('[role="radiogroup"]');
  checkThumbPlacement('外观分段', group, SETTINGS_OPTIONS[1].label);
  assert.ok(!selectedItem(group).className.includes('bg-card'), '选中按钮本身不再画底色，底色由滑块承担');

  act(() => {selectedOf(group, '跟随系统').click();});
  checkThumbPlacement('外观分段（切换后）', group, SETTINGS_OPTIONS[2].label);

  scale = 1.3;
  fireResize();
  checkThumbPlacement('外观分段（字号放大）', group, SETTINGS_OPTIONS[2].label);
  view.unmount();

  view = mount(React.createElement(SettingsSegment, {label: '外观', value: null, options: SETTINGS_OPTIONS, onChange() {}}));
  assert.equal(thumbOf($('[role="radiogroup"]')), null, '没有选中项时不显示滑块');
  view.unmount();
  scale = 1;
}

function checkSegmentedControl() {
  scale = 1;
  let view = mount(React.createElement(TabsHarness, {initial: 'a'}));
  const group = $('[role="tablist"]');
  checkThumbPlacement('标签分段（全宽）', group, TABS_OPTIONS[0].label);
  act(() => {selectedOf(group, '技能市场').click();});
  checkThumbPlacement('标签分段（切换后）', group, TABS_OPTIONS[2].label);
  scale = 1.3;
  fireResize();
  checkThumbPlacement('标签分段（字号放大）', group, TABS_OPTIONS[2].label);
  view.unmount();
  scale = 1;
}

function checkTopbarViewNav() {
  scale = 1;
  const view = mount(React.createElement(WorkspaceViewNav, {
    home: '/workspaces/ws-1', workspaceId: 'ws-1', background: false, knowledge: false, workspacePending: 0,
  }));
  const nav = $('nav[aria-label="工作区视图"]');
  checkThumbPlacement('顶栏工作区视图（对话）', nav, '对话');

  view.rerender(React.createElement(WorkspaceViewNav, {
    home: '/workspaces/ws-1', workspaceId: 'ws-1', background: true, knowledge: false, workspacePending: 0,
  }));
  checkThumbPlacement('顶栏工作区视图（背景）', nav, '背景');

  view.rerender(React.createElement(WorkspaceViewNav, {
    home: '/workspaces/ws-1', workspaceId: 'ws-1', background: false, knowledge: true, workspacePending: 0,
  }));
  checkThumbPlacement('顶栏工作区视图（知识）', nav, '知识');

  scale = 1.25;
  fireResize();
  checkThumbPlacement('顶栏工作区视图（字号放大）', nav, '知识');
  view.unmount();
  scale = 1;
}

function checkTokens() {
  const thumbClass = fs.readFileSync(path.join(root, 'src/components/ui/segment-thumb.tsx'), 'utf8');
  assert.ok(thumbClass.includes('duration-(--motion-mid) ease-(--motion-ease) motion-reduce:transition-none'), '滑块过渡统一使用中速档与缓出曲线，减少动态效果时关闭');
  const segmented = fs.readFileSync(path.join(root, 'src/components/ui/segmented-control.tsx'), 'utf8');
  const settings = fs.readFileSync(path.join(root, 'src/components/settings/settings-row.tsx'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'src/globals.css'), 'utf8');
  assert.ok(segmented.includes('duration-(--motion-mid) ease-(--motion-ease) motion-reduce:transition-none'), '图标标签展开与滑块同步至同一中速档，避免文字抢跑');
  assert.ok(css.includes('grid-template-columns var(--motion-mid) var(--motion-ease)'), '顶栏工作区视图标签与工作台同步使用同一中速档展开');
  for (const [name, source] of [['segmented-control.tsx', segmented], ['settings-row.tsx', settings], ['segment-thumb.tsx', thumbClass]]) {
    assert.ok(!/duration-\d+|transition-transform/.test(source), `${name} 不使用写死的时长`);
    assert.ok(!/\d+ms\b/.test(source), `${name} 不写毫秒数`);
  }
  assert.ok(segmented.includes('relative isolate') && settings.includes('relative isolate'), '根节点建立层叠上下文，滑块在按钮之下');
}

function main() {
  checkSettingsSegment();
  checkSegmentedControl();
  checkTopbarViewNav();
  checkTokens();
  console.log('PASS: segment thumbs (settings, segmented control, and topbar workspace nav) stay aligned through switches and font-scale resizes with unified motion tokens');
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
