/* eslint-disable @typescript-eslint/no-require-imports */
// 工作台宽度：纯函数（范围、读取、预设）加上实际的外观控件与分隔条共用的 hook。
// 检查预设与自定义覆盖完整拖动范围、越界就地提示并夹到范围、与分隔条即时同步、视口变窄时上限变化的行为。
const assert = require('node:assert/strict');
const React = require('react');
const {setupDom} = require('./dom-env.cjs');
const {createLoader} = require('./workspace-loader.cjs');

const pure = createLoader({})('src/lib/workbench-width.ts');
const {clampWorkbenchWidth, readWorkbenchWidth, workbenchPresets, WORKBENCH_DEFAULT_PX, WORKBENCH_WIDTH_KEY} = pure;

// —— 纯函数：范围、读取与预设
assert.equal(WORKBENCH_DEFAULT_PX, 320);
assert.equal(WORKBENCH_WIDTH_KEY, 'rayagent.workbenchWidth');
assert.equal(clampWorkbenchWidth(100, 1400), 260);
assert.equal(clampWorkbenchWidth(9000, 1000), 560);
assert.equal(clampWorkbenchWidth(500, 1400), 500);
assert.equal(readWorkbenchWidth(null, 1400), 320);
assert.equal(readWorkbenchWidth('', 1400), 320);
assert.equal(readWorkbenchWidth('500', 1400), 500);
assert.equal(readWorkbenchWidth('100', 1400), 260);
assert.equal(readWorkbenchWidth('nope', 1400), 320);
const presetValues = viewport => workbenchPresets(viewport).map(item => item.px);
assert.deepEqual(presetValues(1400), [260, 320, 400, 560], '宽窗口：紧凑到最宽覆盖 260–560');
assert.equal(workbenchPresets(1400).at(-1).px, 560, '最宽档等于拖动上限');
assert.deepEqual(presetValues(500), [260, 320, 400, 444], '上限 444 时最宽档随上限下降');
assert.deepEqual(presetValues(316), [260], '上限与下限相同时只保留一档');
assert.ok(presetValues(1400).every(px => px >= 260 && px <= 560), '预设都在拖动范围内');
assert.equal(new Set(presetValues(616)).size, presetValues(616).length, '相同宽度不重复');

// —— 实际控件：外观分区与分隔条共用的 hook
const {window, document, act, flush, createRoot} = setupDom();
const load = createLoader({
  'next-themes': {useTheme: () => ({theme: 'system', setTheme() {}})},
  './form': {SectionHeader: ({title}) => React.createElement('h2', null, title)},
  './settings-row.css': {},
});
const {AppearanceSection} = load('src/components/settings/appearance-section.tsx');
const {useWorkbenchWidth, writeWorkbenchWidth} = load('src/components/workbench/resize-handle.tsx');

// 分隔条使用的同一个 hook；探针只读出宽度，模拟拖动分隔条前后的状态。
function Probe() {
  const {width, min, max} = useWorkbenchWidth();
  return React.createElement('output', {'data-probe': 'true', 'data-min': min, 'data-max': max}, String(width));
}

const input = () => document.getElementById('appearance-workbench-width-input');
const hint = () => document.getElementById('appearance-workbench-width-hint').textContent;
const probe = () => document.querySelector('[data-probe]');
const stored = () => window.localStorage.getItem(WORKBENCH_WIDTH_KEY);
const current = () => Array.from(document.querySelectorAll('#appearance-workbench-width span')).find(node => /px$/.test(node.textContent) && node.classList.contains('tabular-nums'))?.textContent.replace(' px', '');
const presetButton = label => Array.from(document.querySelectorAll('#appearance-workbench-width [role="radio"]')).find(node => node.textContent === label);
const presetLabels = () => Array.from(document.querySelectorAll('#appearance-workbench-width [role="radio"]')).map(node => node.textContent);
const schematic = () => Array.from(document.querySelectorAll('#appearance-workbench-width div[aria-hidden] > div')).find(node => node.style.width.endsWith('%'));

function setNativeValue(node, value) {
  const proto = window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(node, value);
}

function typeText(value) {
  act(() => {
    setNativeValue(input(), value);
    input().dispatchEvent(new window.Event('input', {bubbles: true}));
  });
}

function pressEnter() {
  act(() => {input().dispatchEvent(new window.KeyboardEvent('keydown', {key: 'Enter', bubbles: true}));});
}

function blur() {
  act(() => {input().dispatchEvent(new window.FocusEvent('focusout', {bubbles: true}));});
}

async function main() {
  window.localStorage.clear();
  window.innerWidth = 1400;
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(React.createElement(React.Fragment, null, React.createElement(AppearanceSection), React.createElement(Probe)));
  });
  await flush(2);

  // —— 预设：覆盖完整范围，选中态与分隔条共用的存储
  assert.deepEqual(presetLabels(), ['紧凑 260', '标准 320', '较宽 400', '最宽 560'], '预设覆盖 260 至 560');
  assert.equal(current(), '320', '默认显示 320');
  assert.equal(presetButton('标准 320').getAttribute('aria-checked'), 'true', '默认档选中');
  act(() => presetButton('较宽 400').click());
  assert.equal(stored(), '400', '预设写入现有存储');
  assert.equal(probe().textContent, '400', '分隔条使用的状态即时同步');
  assert.equal(current(), '400', '当前宽度即时显示');
  assert.equal(presetButton('较宽 400').getAttribute('aria-checked'), 'true');
  assert.equal(input().value, '400', '自定义输入同步当前值');
  act(() => presetButton('最宽 560').click());
  assert.equal(stored(), '560');
  assert.equal(input().getAttribute('max'), '560', '自定义上限与最宽一致');
  assert.equal(input().getAttribute('min'), '260', '自定义下限与紧凑一致');

  // —— 示意图：占窗口宽度的比例随当前值变化
  act(() => presetButton('紧凑 260').click());
  const ratio = Number.parseFloat(schematic().style.width);
  assert.ok(Math.abs(ratio - (260 / 1400) * 100) < 0.01, '示意图按窗口宽度比例');

  // —— 自定义：范围内直接生效
  typeText('300');
  pressEnter();
  assert.equal(stored(), '300', '范围内自定义直接生效');
  assert.equal(hint(), '', '范围内没有提示');
  assert.equal(probe().textContent, '300');

  // —— 越界：就地提示并夹到范围，不静默改值
  typeText('9999');
  pressEnter();
  assert.equal(stored(), '560', '高于上限夹到上限');
  assert.equal(hint(), '9999 px 高于上限，已调整为 560 px。', '就地提示');
  assert.equal(input().value, '560', '输入框显示夹后的值');
  assert.equal(probe().textContent, '560', '分隔条同步夹后的值');

  typeText('100');
  blur();
  assert.equal(stored(), '260', '低于下限夹到下限');
  assert.equal(hint(), '100 px 低于下限，已调整为 260 px。', '失焦也提示');
  assert.equal(input().value, '260');

  // —— 非法输入：提示并恢复当前值，宽度不变
  typeText('300.5');
  pressEnter();
  assert.equal(stored(), '260', '非整数不改变宽度');
  assert.equal(hint(), '请输入 260 至 560 之间的整数像素。', '非整数给出提示');
  assert.equal(input().value, '260', '恢复当前值');
  typeText('');
  pressEnter();
  assert.equal(hint(), '请输入 260 至 560 之间的整数像素。', '空输入给出提示');
  assert.equal(stored(), '260');

  // —— 分隔条写入同步到外观控件（与拖动走同一函数）
  act(() => writeWorkbenchWidth(333));
  assert.equal(probe().textContent, '333');
  assert.equal(current(), '333', '外观控件同步分隔条的改动');
  assert.equal(input().value, '333');
  assert.equal(hint(), '', '同步不残留旧提示');
  assert.equal(presetButton('标准 320').getAttribute('aria-checked'), 'false', '非预设值没有选中档');

  // —— 视口变窄：上限变化，分隔条与外观控件行为一致
  act(() => writeWorkbenchWidth(560));
  window.innerWidth = 500;
  act(() => {window.dispatchEvent(new window.Event('resize'));});
  await flush(1);
  assert.equal(probe().getAttribute('data-max'), '444', '分隔条上限随视口下降');
  assert.equal(probe().textContent, '444', '显示夹到新上限');
  assert.equal(current(), '444', '外观控件显示实际宽度');
  assert.equal(input().getAttribute('max'), '444', '自定义上限同步');
  assert.deepEqual(presetLabels(), ['紧凑 260', '标准 320', '较宽 400', '最宽 444'], '最宽档随上限变化');
  assert.equal(stored(), '560', '保存的偏好保留，视口恢复后仍生效');
  window.innerWidth = 1400;
  act(() => {window.dispatchEvent(new window.Event('resize'));});
  await flush(1);
  assert.equal(probe().textContent, '560', '视口恢复后回到保存的宽度');

  // —— 恢复默认
  act(() => Array.from(document.querySelectorAll('button')).find(node => node.textContent === '恢复默认（320）').click());
  assert.equal(stored(), '320', '恢复默认写入 320');
  assert.equal(probe().textContent, '320');
  assert.equal(current(), '320');

  act(() => root.unmount());
  container.remove();
  console.log('PASS: workbench presets cover the drag range, custom input clamps with hints, shared state syncs with the handle, and narrowing the viewport clamps both');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
