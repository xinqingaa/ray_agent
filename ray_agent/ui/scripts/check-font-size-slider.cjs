/* eslint-disable @typescript-eslint/no-require-imports */
// 阅读字号滑杆：挂载实际的外观分区与公共滑杆，检查每个整数都有刻度、点按与拖动、方向键、即时生效与持久化、
// 一行预览与恢复默认。DOM 替身见 dom-env.cjs；真实 WebView 的指针几何与字体渲染需在宿主窗口走查。
const assert = require('node:assert/strict');
const React = require('react');
const {setupDom} = require('./dom-env.cjs');
const {createLoader} = require('./workspace-loader.cjs');

const {window, document, act, createRoot} = setupDom();
const load = createLoader({
  'next-themes': {useTheme: () => ({theme: 'system', setTheme() {}})},
  './form': {SectionHeader: ({title}) => React.createElement('h2', null, title)},
  './settings-row.css': {},
});
const {AppearanceSection} = load('src/components/settings/appearance-section.tsx');
const fontSize = load('src/lib/font-size.ts');

const KEY = fontSize.FONT_SIZE_KEY;
const slider = () => document.querySelector('[role="slider"][aria-label="阅读字号"]');
const readout = () => Array.from(document.querySelectorAll('span[aria-hidden]')).find(node => /^\d+px$/.test(node.textContent))?.textContent;
const preview = () => document.querySelector('p[aria-hidden][style]');
const fontScale = () => Number.parseFloat(document.documentElement.style.getPropertyValue('--font-scale'));
const storedSize = () => window.localStorage.getItem(KEY);
const restoreButton = () => Array.from(document.querySelectorAll('button')).find(node => node.textContent === '恢复默认（14px）');

function mount() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {root.render(React.createElement(AppearanceSection));});
  return {root, container};
}

function unmount(view) {
  act(() => {view.root.unmount();});
  view.container.remove();
}

function key(name) {
  act(() => {slider().dispatchEvent(new window.KeyboardEvent('keydown', {key: name, bubbles: true}));});
}

function pointer(type, clientX) {
  const target = slider();
  act(() => {target.dispatchEvent(new window.MouseEvent(type, {clientX, bubbles: true, button: 0}));});
}

function stubGeometry() {
  // 布局不可用：给滑杆一个 300px 宽的矩形，刻度位置即可由 clientX 推算（内边距 12px，内宽 276px）。
  slider().getBoundingClientRect = () => ({left: 0, top: 0, right: 300, bottom: 32, width: 300, height: 32, x: 0, y: 0, toJSON() {}});
}

async function main() {
  // —— 整数刻度：范围内每个整数一档，档名为像素值，原始值作为刻度提示
  assert.deepEqual(fontSize.FONT_SIZE_STEPS.map(step => step.id), ['14', '15', '16', '17', '18', '19', '20']);
  assert.equal(fontSize.acceptedFontSize(14.5), null, '非整数拒绝');
  assert.equal(fontSize.acceptedFontSize(13), null, '低于下限拒绝');
  assert.equal(fontSize.acceptedFontSize(21), null, '高于上限拒绝');
  assert.equal(fontSize.acceptedFontSize(20), 20, '上限可用');

  window.localStorage.clear();
  let view = mount();
  assert.ok(slider(), '滑杆存在');
  const titles = Array.from(slider().querySelectorAll('span[title]')).map(node => node.getAttribute('title'));
  assert.deepEqual(titles, ['14', '15', '16', '17', '18', '19', '20'], '每个整数都有刻度');
  assert.equal(slider().getAttribute('tabindex'), '0', '滑杆是键盘焦点');
  assert.equal(slider().getAttribute('aria-valuetext'), '14px', '默认 14px，读屏读出像素');
  assert.equal(readout(), '14px', '旁边显示当前数值');
  assert.equal(preview().style.fontSize, '14px', '预览一行即时使用当前字号');
  assert.equal(preview().textContent.includes('\n'), false, '预览是一行');

  // —— 方向键：即时生效（CSS 变量与预览同步）并写入本地存储
  stubGeometry();
  key('ArrowRight');
  assert.equal(slider().getAttribute('aria-valuetext'), '15px');
  assert.equal(readout(), '15px');
  assert.equal(preview().style.fontSize, '15px');
  assert.equal(storedSize(), '15', '写入现有存储键');
  assert.ok(Math.abs(fontScale() - 15 / 14) < 1e-9, '根字号比例即时生效');
  key('End');
  assert.equal(slider().getAttribute('aria-valuetext'), '20px', 'End 到最大');
  key('ArrowRight');
  assert.equal(slider().getAttribute('aria-valuetext'), '20px', '末档不越界');
  key('Home');
  assert.equal(slider().getAttribute('aria-valuetext'), '14px', 'Home 到最小');
  key('ArrowDown');
  assert.equal(slider().getAttribute('aria-valuetext'), '14px', '下限不越界');

  // —— 点按：按坐标落到最近的整数刻度
  pointer('pointerdown', 12 + 276 * (4 / 6));
  pointer('pointerup', 12 + 276 * (4 / 6));
  assert.equal(slider().getAttribute('aria-valuetext'), '18px', '点按到 18');
  assert.equal(storedSize(), '18');

  // —— 拖动：按下后移动改变档位，松开后停止跟随
  pointer('pointerdown', 12);
  assert.equal(slider().getAttribute('aria-valuetext'), '14px', '按下即落到起点');
  pointer('pointermove', 12 + 276 * (3 / 6) + 4);
  assert.equal(slider().getAttribute('aria-valuetext'), '17px', '拖动到 17');
  pointer('pointerup', 12 + 276 * (3 / 6) + 4);
  pointer('pointermove', 12 + 276 * (6 / 6));
  assert.equal(slider().getAttribute('aria-valuetext'), '17px', '松开后移动不改档位');
  assert.equal(storedSize(), '17');

  // —— 持久化：卸载重挂后仍是保存的字号
  unmount(view);
  view = mount();
  assert.equal(slider().getAttribute('aria-valuetext'), '17px', '重新挂载读取持久化值');
  assert.equal(fontSize.readFontSize(), 17);
  assert.equal(readout(), '17px');

  // —— 恢复默认
  act(() => restoreButton().click());
  assert.equal(slider().getAttribute('aria-valuetext'), '14px', '恢复默认');
  assert.equal(storedSize(), '14');
  assert.equal(preview().style.fontSize, '14px');
  unmount(view);

  // —— 存储中的越界或损坏值回到默认
  window.localStorage.setItem(KEY, '99');
  assert.equal(fontSize.readFontSize(), 14, '越界存储值回到默认');
  window.localStorage.setItem(KEY, 'abc');
  assert.equal(fontSize.readFontSize(), 14, '损坏存储值回到默认');

  console.log('check-font-size-slider: 通过');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
