/* eslint-disable @typescript-eslint/no-require-imports */
// 需要 DOM 的检查脚本共用：用 jsdom 建立文档，把浏览器全局补到 Node 上，并给出 jsdom 缺少的能力（布局矩形、contenteditable 判定、execCommand）。
// jsdom 没有布局与真实编辑历史：这里的 execCommand 只模拟 insertText 的替换与 input 事件，真实撤销与选区几何需在宿主窗口走查。
const React = require('react');
const {JSDOM} = require('jsdom');

function setupDom() {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {pretendToBeVisual: true, url: 'http://localhost/'});
  const {window} = dom;
  const {document} = window;

  global.window = window;
  global.document = document;
  // Node 自带的 Event 等类型必须换成 jsdom 的，否则 dispatchEvent 的类型检查会失败。
  const replaceInNode = /^(Event|CustomEvent|EventTarget|UIEvent|MouseEvent|KeyboardEvent|FocusEvent|PointerEvent|DOMException)$/;
  for (const key of Object.getOwnPropertyNames(window)) {
    if ((key in global && !replaceInNode.test(key)) || key.startsWith('_') || key === 'undefined') continue;
    Object.defineProperty(global, key, {get: () => window[key], configurable: true});
  }
  global.IS_REACT_ACT_ENVIRONMENT = true;
  global.ResizeObserver = class {observe() {} unobserve() {} disconnect() {}};
  window.ResizeObserver = global.ResizeObserver;

  // 选区矩形：jsdom 不计算布局，统一给出 0..100 像素的覆盖区域。
  window.Range.prototype.getClientRects = () => [{left: 0, top: 0, right: 100, bottom: 100}];
  // contenteditable 判定：jsdom 未实现 isContentEditable，按属性判定。
  Object.defineProperty(window.HTMLElement.prototype, 'isContentEditable', {
    configurable: true,
    get() {
      const host = this.closest('[contenteditable]');
      return Boolean(host) && host.getAttribute('contenteditable') !== 'false';
    },
  });

  const execState = {supported: true, calls: []};
  document.execCommand = (command, _ui, value) => {
    if (command !== 'insertText' || !execState.supported) return false;
    execState.calls.push(value);
    const el = document.activeElement;
    if (el instanceof window.HTMLInputElement || el instanceof window.HTMLTextAreaElement) {
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? start;
      const next = el.value.slice(0, start) + value + el.value.slice(end);
      const proto = el instanceof window.HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      // 原生值设置器：绕过 React 的值追踪，使受控输入能收到变化
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, next);
      el.setSelectionRange(start + value.length, start + value.length);
      el.dispatchEvent(new window.Event('input', {bubbles: true}));
      return true;
    }
    if (el?.isContentEditable) {
      // 简化：整体替换内容（jsdom 没有 contenteditable 的选区模型）
      el.textContent = value;
      el.dispatchEvent(new window.Event('input', {bubbles: true}));
      return true;
    }
    return false;
  };

  const act = React.act ?? require('react-dom/test-utils').act;
  const {createRoot} = require('react-dom/client');
  const flush = async (rounds = 5) => {
    for (let i = 0; i < rounds; i++) await act(async () => {await new Promise(resolve => setTimeout(resolve, 5));});
  };
  return {window, document, act, flush, createRoot, execState};
}

module.exports = {setupDom};
