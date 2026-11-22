/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const React = require('react');
const {setupDom} = require('./dom-env.cjs');
const {createLoader} = require('./workspace-loader.cjs');

const {window, document, act, createRoot, flush} = setupDom();
const load = createLoader({
  'next-themes': {useTheme: () => ({theme: 'system', setTheme() {}})},
  './form': {SectionHeader: ({title}) => React.createElement('h2', null, title)},
  './settings-row.css': {},
});
const {AppearanceSection} = load('src/components/settings/appearance-section.tsx');
const {FONT_SIZE_KEY, readFontSize} = load('src/lib/font-size.ts');

const input = () => document.getElementById('appearance-size-input');
const storedSize = () => window.localStorage.getItem(FONT_SIZE_KEY);
const restore = () => document.querySelector('[aria-label="恢复默认阅读字号"]');

function mount(container) {
  const root = createRoot(container);
  act(() => root.render(React.createElement(AppearanceSection)));
  return root;
}

function setCustom(value) {
  act(() => {
    const node = input();
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(node, value);
    node.dispatchEvent(new window.Event('input', {bubbles: true}));
  });
}

function key(target, name) {
  act(() => target.dispatchEvent(new window.KeyboardEvent('keydown', {key: name, bubbles: true})));
}

async function main() {
  const container = document.getElementById('root');
  let root = mount(container);
  await flush(1);
  const selector = () => document.querySelector('button[aria-label="阅读字号"]');
  const options = () => Array.from(document.querySelectorAll('[role="listbox"][aria-label="阅读字号"] [role="option"]'));
  const submit = () => act(() => input().form.dispatchEvent(new window.Event('submit', {bubbles:true, cancelable:true})));
  const openCustom = async () => {
    act(() => selector().click());
    const custom = options().at(-1);
    assert.equal(custom.getAttribute('aria-label'), '自定义阅读字号');
    assert.ok(custom.querySelector('svg') && !custom.textContent, '最后一项只显示图标');
    act(() => custom.click());
    await flush(2);
  };
  assert.equal(selector().textContent, '14 px');
  assert.equal(input(), null);
  act(() => selector().click());
  const entries = options();
  assert.deepEqual(entries.slice(0, -1).map(node => node.textContent), ['14 px','16 px','18 px','20 px']);
  key(entries[0], 'ArrowDown');
  assert.ok(document.activeElement === entries[1], `方向键焦点应在第二项，实际 ${document.activeElement?.textContent?.slice(0,40)}`);
  act(() => entries[1].click());
  assert.equal(storedSize(), '16');
  assert.equal(selector().textContent, '16 px');

  await openCustom();
  assert.ok(document.activeElement === input(), `自定义输入应获取焦点，实际 ${document.activeElement?.tagName} ${document.activeElement?.getAttribute("aria-label")}`);
  assert.equal(input().value, '16');
  for (const excluded of ['21','13','16.5','1e1','abc','']) {
    setCustom(excluded);
    submit();
    assert.equal(storedSize(), '16', '无效输入不保存');
    assert.equal(input().getAttribute('aria-invalid'), 'true');
    assert.equal(selector().textContent, '16 px');
  }
  setCustom('17');
  submit();
  assert.equal(storedSize(), '17');
  assert.equal(input(), null);
  assert.ok(document.activeElement === selector(), "应用后焦点回到选择器");
  assert.equal(Number(document.documentElement.style.getPropertyValue('--font-scale')), 17 / 14);

  act(() => root.unmount());
  root = mount(container);
  assert.equal(selector().textContent, '17 px', '重开显示自定义数值');
  await openCustom();
  setCustom('15');
  key(input(), 'Escape');
  assert.equal(storedSize(), '17', '取消编辑保留原值');
  assert.equal(input(), null);
  act(() => restore().click());
  assert.equal(storedSize(), '14');
  assert.equal(selector().textContent, '14 px');
  assert.doesNotMatch(container.textContent, /周会纪要/);
  const radios = Array.from(document.querySelectorAll('#appearance-theme [role="radio"]'));
  assert.deepEqual(radios.map(item => item.getAttribute('aria-label')), ['跟随系统', '浅色', '深色']);
  assert.ok(radios.every(item => item.querySelector('svg') && !item.textContent), '主题使用图标及可访问名称');
  act(() => root.unmount());

  window.localStorage.setItem(FONT_SIZE_KEY, '99');
  assert.equal(readFontSize(), 14);
  window.localStorage.setItem(FONT_SIZE_KEY, 'abc');
  assert.equal(readFontSize(), 14);
  console.log('PASS: 字号预设、键盘、自定义图标及合法值校验、即时生效、重开持久化、恢复默认及主题图标');
}

main().catch(error => {console.error(error); process.exitCode = 1;});
