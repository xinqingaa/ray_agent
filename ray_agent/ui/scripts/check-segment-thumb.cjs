/* eslint-disable @typescript-eslint/no-require-imports */
// 分段控件滑块：挂载实际的 SettingsSegment 与 SegmentedControl，检查滑块贴合选中项的位置与尺寸、
// 切换选中后跟随、字号缩放（尺寸变化）后重新测量，没有选中项时不显示滑块，以及动效只使用 token 并尊重减少动态效果。
// jsdom 没有布局：偏移与宽度用替身（宽度随字符数与字号系数变化），ResizeObserver 由检查手动触发；
// 真实的弹性手感与换行表现需在宿主窗口走查。
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const React = require('react');
const {setupDom} = require('./dom-env.cjs');
const {createLoader} = require('./workspace-loader.cjs');

const root = path.resolve(__dirname, '..');
const {window, document, act, createRoot} = setupDom();

// 字号系数：影响按钮的文字宽度（与 --font-scale 的效果一致）。
let scale = 1;
const SEGMENT_HEIGHT = 30;
const buttonsOf = node => Array.from(node.parentElement?.children ?? []).filter(child => child.tagName === 'BUTTON');
const widthOf = node => Math.round(node.textContent.length * 14 * scale + 20);
Object.defineProperty(window.HTMLElement.prototype, 'offsetWidth', {
  configurable: true,
  get() {return this.tagName === 'BUTTON' ? widthOf(this) : 0;},
});
Object.defineProperty(window.HTMLElement.prototype, 'offsetHeight', {
  configurable: true,
  get() {return this.tagName === 'BUTTON' ? SEGMENT_HEIGHT : 0;},
});
Object.defineProperty(window.HTMLElement.prototype, 'offsetTop', {configurable: true, get() {return 0;}});
Object.defineProperty(window.HTMLElement.prototype, 'offsetLeft', {
  configurable: true,
  get() {
    if (this.tagName !== 'BUTTON') return 0;
    const buttons = buttonsOf(this);
    const index = buttons.indexOf(this);
    // 按钮之间有 2px 间距，与 gap-0.5 一致
    return buttons.slice(0, index).reduce((sum, button) => sum + widthOf(button) + 2, 0);
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
});
const {SettingsSegment} = load('src/components/settings/settings-row.tsx');
const {SegmentedControl} = load('src/components/ui/segmented-control.tsx');

const $ = selector => document.querySelector(selector);
const thumbOf = group => group.querySelector(':scope > span[aria-hidden="true"]');
const selectedButton = group => group.querySelector(':scope > [aria-checked="true"], :scope > [aria-selected="true"]');
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
    unmount: () => {
      act(() => {root.unmount();});
      container.remove();
    },
  };
}

const SETTINGS_OPTIONS = [{value: 'a', label: '浅色'}, {value: 'b', label: '深色'}, {value: 'c', label: '跟随系统'}];
const TABS_OPTIONS = [{value: 'a', label: '全部'}, {value: 'b', label: '已安装'}, {value: 'c', label: '技能市场'}];

// 受控包装：点击或方向键改变选中，模拟真实页面的状态流
function SettingsHarness({initial}) {
  const [value, setValue] = React.useState(initial);
  return React.createElement(SettingsSegment, {label: '外观', value, options: SETTINGS_OPTIONS, onChange: setValue});
}

function TabsHarness({initial}) {
  const [value, setValue] = React.useState(initial);
  return React.createElement(SegmentedControl, {label: '视图', value, onValueChange: setValue, options: TABS_OPTIONS});
}

function checkThumbPlacement(name, group, optionKey) {
  const thumb = thumbOf(group);
  assert.ok(thumb, `${name}：选中项存在时显示滑块`);
  const selected = selectedButton(group);
  assert.equal(selected.textContent, optionKey.label, `${name}：选中项是 ${optionKey.label}`);
  const position = parseTransform(thumb.style.transform);
  assert.ok(position, `${name}：滑块用 transform 定位`);
  assert.equal(position.left, selected.offsetLeft, `${name}：滑块的横向位置贴合选中项`);
  assert.equal(thumb.style.width, `${selected.offsetWidth}px`, `${name}：滑块宽度贴合选中项`);
  assert.equal(thumb.style.height, `${selected.offsetHeight}px`, `${name}：滑块高度贴合选中项`);
}

function checkSettingsSegment() {
  scale = 1;
  let view = mount(React.createElement(SettingsHarness, {initial: 'b'}));
  const group = $('[role="radiogroup"]');
  checkThumbPlacement('外观分段', group, SETTINGS_OPTIONS[1]);
  assert.ok(!selectedButton(group).className.includes('bg-card'), '选中按钮本身不再画底色，底色由滑块承担');

  // 切换选中：滑块跟随到新选中项
  act(() => {selectedOf(group, '跟随系统').click();});
  checkThumbPlacement('外观分段（切换后）', group, SETTINGS_OPTIONS[2]);

  // 字号缩放：按钮变宽，RO 重新测量后滑块宽度与位置仍贴合
  scale = 1.3;
  fireResize();
  checkThumbPlacement('外观分段（字号放大）', group, SETTINGS_OPTIONS[2]);
  view.unmount();

  // 没有选中项时不显示滑块
  view = mount(React.createElement(SettingsSegment, {label: '外观', value: null, options: SETTINGS_OPTIONS, onChange() {}}));
  assert.equal(thumbOf($('[role="radiogroup"]')), null, '没有选中项时不显示滑块');
  view.unmount();
  scale = 1;
}

function selectedOf(group, label) {
  return Array.from(group.querySelectorAll(':scope > button')).find(node => node.textContent === label);
}

function checkSegmentedControl() {
  scale = 1;
  let view = mount(React.createElement(TabsHarness, {initial: 'a'}));
  const group = $('[role="tablist"]');
  checkThumbPlacement('标签分段（全宽）', group, TABS_OPTIONS[0]);
  act(() => {selectedOf(group, '技能市场').click();});
  checkThumbPlacement('标签分段（切换后）', group, TABS_OPTIONS[2]);
  scale = 1.3;
  fireResize();
  checkThumbPlacement('标签分段（字号放大）', group, TABS_OPTIONS[2]);
  view.unmount();
  scale = 1;
}

function checkTokens() {
  const thumbClass = fs.readFileSync(path.join(root, 'src/components/ui/segment-thumb.tsx'), 'utf8');
  assert.ok(thumbClass.includes('duration-(--motion-slow) ease-(--motion-spring) motion-reduce:transition-none'), '滑块弹性过渡用慢档与弹性曲线，减少动态效果时关闭');
  const segmented = fs.readFileSync(path.join(root, 'src/components/ui/segmented-control.tsx'), 'utf8');
  const settings = fs.readFileSync(path.join(root, 'src/components/settings/settings-row.tsx'), 'utf8');
  assert.ok(segmented.includes('duration-(--motion-slow) ease-(--motion-spring) motion-reduce:transition-none'), '图标标签展开用慢档弹性，与原型的标签展开一致');
  for (const [name, source] of [['segmented-control.tsx', segmented], ['settings-row.tsx', settings], ['segment-thumb.tsx', thumbClass]]) {
    assert.ok(!/duration-\d+|transition-transform/.test(source), `${name} 不使用写死的时长`);
    assert.ok(!/\d+ms\b/.test(source), `${name} 不写毫秒数`);
  }
  // 滑块在根节点定位上下文中、层级在按钮之下
  assert.ok(segmented.includes('relative isolate') && settings.includes('relative isolate'), '根节点建立层叠上下文，滑块在按钮之下');
}

function main() {
  checkSettingsSegment();
  checkSegmentedControl();
  checkTokens();
  console.log('PASS: segment thumbs follow the selected option through selection changes and font-scale resizes, hide without a selection, and use motion tokens');
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
