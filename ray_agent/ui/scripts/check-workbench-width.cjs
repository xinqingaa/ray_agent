/* eslint-disable @typescript-eslint/no-require-imports */
// 工作台宽度：纯函数（范围与读取）加上实际的外观控件与分隔条共用的 hook。
// 检查预设与自定义、越界提示及保留已有数值、与分隔条即时同步、视口变窄时上限变化的行为。
const assert = require('node:assert/strict');
const React = require('react');
const {setupDom} = require('./dom-env.cjs');
const {createLoader} = require('./workspace-loader.cjs');

const pure = createLoader({})('src/lib/workbench-width.ts');
const {clampWorkbenchWidth, readWorkbenchWidth, workbenchBounds, WORKBENCH_DEFAULT_PX, WORKBENCH_WIDTH_KEY} = pure;

// —— 纯函数：范围与读取
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
assert.deepEqual(workbenchBounds(1400), {min: 260, max: 560});
assert.deepEqual(workbenchBounds(500), {min: 260, max: 444});
assert.deepEqual(workbenchBounds(316), {min: 260, max: 260});

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
const hint = () => document.getElementById('appearance-workbench-width-hint')?.textContent;
const probe = () => document.querySelector('[data-probe]');
const stored = () => window.localStorage.getItem(WORKBENCH_WIDTH_KEY);
const selector = () => document.querySelector('button[aria-label="工作台宽度"]');
const options = () => Array.from(document.querySelectorAll('[role="listbox"][aria-label="工作台宽度"] [role="option"]'));
const openOptions = () => act(() => selector().click());

async function openCustom() {
  openOptions();
  const custom = options().at(-1);
  assert.equal(custom.getAttribute('aria-label'), '自定义工作台宽度');
  assert.ok(custom.querySelector('svg'));
  act(() => custom.click());
  await flush(2);
}

function setCustom(value) {
  act(() => {
    const node = input();
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(node, value);
    node.dispatchEvent(new window.Event('input', {bubbles: true}));
  });
}

function submit() {
  act(() => input().form.dispatchEvent(new window.Event('submit', {bubbles: true, cancelable: true})));
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

  assert.equal(selector().textContent, '320 px');
  assert.equal(input(), null);
  openOptions();
  assert.deepEqual(options().slice(0,-1).map(node => node.textContent), ['紧凑 · 260 px','标准 · 320 px','较宽 · 400 px','最宽 · 560 px']);
  act(() => options()[2].click());
  assert.equal(stored(), '400');
  assert.equal(probe().textContent, '400');

  await openCustom();
  assert.equal(input().value, '400');
  for (const invalid of ['9999','100','300.5','']) {
    setCustom(invalid);
    submit();
    assert.equal(stored(), '400', '非法值不保存也不被自动夹回');
    assert.equal(probe().textContent, '400');
    assert.match(hint(), /260–560 px/);
  }
  setCustom('333');
  submit();
  assert.equal(input(), null);
  assert.equal(stored(), '333');
  assert.equal(selector().textContent, '333 px');
  assert.equal(probe().textContent, '333');

  act(() => writeWorkbenchWidth(560));
  window.innerWidth = 500;
  act(() => window.dispatchEvent(new window.Event('resize')));
  await flush(1);
  assert.equal(probe().getAttribute('data-max'), '444');
  assert.equal(selector().textContent, '444 px');
  assert.equal(stored(), '560', '缩窄窗口保留已保存的宽度');
  openOptions();
  assert.equal(options().at(-2).textContent, '最宽 · 444 px');
  act(() => options().at(-1).click());
  await flush(2);
  setCustom('500');
  submit();
  assert.equal(stored(), '560');
  assert.match(hint(), /260–444 px/);

  window.innerWidth = 1400;
  act(() => window.dispatchEvent(new window.Event('resize')));
  await flush(1);
  assert.equal(probe().textContent, '560');
  act(() => document.querySelector('[aria-label="恢复默认工作台宽度"]').click());
  assert.equal(stored(), '320');
  assert.equal(probe().textContent, '320');
  assert.equal(selector().textContent, '320 px');
  assert.equal(input(), null);

  act(() => root.unmount());
  container.remove();
  console.log('PASS: 工作台宽度预设、自定义校验、分隔条同步及窄窗口限制');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
