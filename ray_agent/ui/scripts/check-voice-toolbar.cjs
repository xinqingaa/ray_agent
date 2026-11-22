/* eslint-disable @typescript-eslint/no-require-imports */
// 语音工具栏：挂载实际的 VoiceToolbar 与设置里的语音行，检查各阶段结构、麦克风展开时的占位与宽度测量、
// 阶段切换的淡出层（含减少动态效果分支）、animationend 清理、回填高亮的减少动效分支、设置中本地与远程子行的折叠，
// 以及样式文件里的曲线、减少动效块与 token。布局宽度、ResizeObserver、matchMedia 与 WAAPI 用替身；
// 真实的展开手感、录音与转写的端到端行为需在宿主窗口走查。
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const React = require('react');
const {setupDom} = require('./dom-env.cjs');
const {createLoader} = require('./workspace-loader.cjs');

const root = path.resolve(__dirname, '..');
const {window, document, act, createRoot} = setupDom();

const REDUCE = '(prefers-reduced-motion: reduce)';
let reduceMotion = false;
window.matchMedia = query => ({matches: reduceMotion && query === REDUCE, media: query, addEventListener() {}, removeEventListener() {}});

// 测量替身：胶囊展开宽度取舞台的 offsetWidth；ResizeObserver 记录回调，便于模拟内容宽度变化。
let stageWidth = 0;
Object.defineProperty(window.HTMLElement.prototype, 'offsetWidth', {
  configurable: true,
  get() {return this.classList?.contains('composer-voice-stage') ? stageWidth : 0;},
});
const observers = [];
global.ResizeObserver = class {
  constructor(callback) {this.callback = callback; this.disconnected = false; observers.push(this);}
  observe() {}
  unobserve() {}
  disconnect() {this.disconnected = true;}
};
const liveObserver = () => observers.filter(item => !item.disconnected).at(-1);

const load = createLoader({
  './voice-input.css': {},
  './form': {errorMessage: (_reason, fallback) => fallback},
  './settings-row.css': {},
  '@/components/ui/select': {Select: () => null},
  '@/components/voice-model-status': {VoiceModelStatus: () => null, useVoiceModel: () => null},
  '@/hooks/use-usage-preferences': {
    useUsagePreferences: () => ({value: null, error: null}),
    reloadUsagePreferences() {},
    setUsagePreferences: async () => {},
  },
  '@/hooks/use-voice-service': {useVoiceService: () => ({phase: 'unconfigured'})},
  '@/lib/settings-navigation': {openSettingsSection() {}},
});
const {VoiceToolbar} = load('src/components/voice-toolbar.tsx');
const {VoiceSettingRow} = load('src/components/settings/voice-settings.tsx');
const motion = load('src/lib/motion.ts');
const {VOICE_OPTIONS} = load('src/lib/voice-options.ts');

const $ = selector => document.querySelector(selector);
const $$ = selector => Array.from(document.querySelectorAll(selector));
const textOf = selector => $(selector)?.textContent ?? '';
const byLabel = label => $(`[aria-label="${label}"]`);
const byText = (text, selector = 'button') => $$(selector).find(node => node.textContent.trim() === text);
const toolbarEl = () => $('[data-voice-toolbar]');
const sheetEl = () => $('.composer-voice-sheet');

function mount(element) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {root.render(element);});
  return {
    update: next => act(() => {root.render(next);}),
    unmount: () => {
      act(() => {root.unmount();});
      container.remove();
    },
  };
}

// jsdom 没有 AnimationEvent，且 React 不会从这里派发的 animationend 调到处理器；
// 因此直接调用节点上挂载的 React onAnimationEnd，并传入与浏览器一致的 target / currentTarget。
function animationEnd(node, target = node) {
  const propsKey = Object.keys(node).find(key => key.startsWith('__reactProps$'));
  assert.ok(propsKey, '淡出层应带有 React 处理器');
  act(() => {node[propsKey].onAnimationEnd({target, currentTarget: node, type: 'animationend'});});
}

function toolbar(props = {}, handlers = {}) {
  return React.createElement(VoiceToolbar, {phase: 'idle', method: '本机', ...props, ...handlers});
}

function checkPhases() {
  // 空闲：只有麦克风，胶囊收起、不可交互、不占位
  let view = mount(toolbar({phase: 'idle'}));
  assert.equal(toolbarEl().dataset.phase, 'idle');
  assert.equal(toolbarEl().dataset.mode, 'idle');
  assert.ok(byLabel('开始录音'), '空闲显示麦克风');
  assert.equal(sheetEl().dataset.open, 'false', '空闲时胶囊收起');
  assert.ok(sheetEl().hasAttribute('inert'), '收起的胶囊不可交互');
  assert.equal(sheetEl().getAttribute('aria-hidden'), 'true');
  assert.ok(!$('.composer-voice-anchor'), '空闲时不需要占位');
  view.unmount();

  // 启动录音：胶囊展开，显示取消与状态
  view = mount(toolbar({phase: 'permission'}));
  assert.equal(toolbarEl().dataset.mode, 'sheet');
  assert.equal(sheetEl().dataset.open, 'true');
  assert.ok($('.composer-voice-anchor'), '展开时麦克风位置留占位');
  assert.ok(textOf('.composer-voice-status').includes('正在启动录音'));
  assert.ok(byLabel('取消语音输入'), '启动中可取消');
  assert.ok(!byLabel('完成录音'), '启动中不能完成');
  assert.equal(sheetEl().hasAttribute('inert'), false);
  assert.equal(sheetEl().getAttribute('aria-hidden'), null);
  view.unmount();

  // 录音：取消、波形、计时、完成
  const handlers = {onCancel: counter('cancel'), onFinish: counter('finish')};
  view = mount(toolbar({phase: 'recording', seconds: 42, levels: [0.2, 0.5]}, handlers));
  assert.equal(toolbarEl().dataset.mode, 'sheet');
  assert.equal($$('.composer-voice-wave > i').length, 12, '波形 12 根');
  assert.equal(textOf('.composer-voice-time'), '00:42', '正计时');
  assert.equal($('.composer-voice-time').dataset.countdown, 'false');
  assert.ok($('[aria-label="已录音 42 秒"]') === $('.composer-voice-time'), '计时带可读的录音时长');
  assert.ok(textOf('[role="status"]').includes('正在录音'));
  byLabel('取消语音输入').click();
  byLabel('完成录音').click();
  assert.equal(counted.cancel, 1, '取消按钮触发取消');
  assert.equal(counted.finish, 1, '完成按钮触发完成');
  view.unmount();

  // 倒计时：最后 10 秒切换为剩余时间
  view = mount(toolbar({phase: 'recording', seconds: 112}));
  assert.equal(textOf('.composer-voice-time'), '剩余00:08', '最后 10 秒显示剩余');
  assert.equal($('.composer-voice-time').dataset.countdown, 'true');
  view.update(toolbar({phase: 'recording', seconds: 109}));
  assert.equal(textOf('.composer-voice-time'), '01:49', '倒计时前显示已录音时长');
  assert.equal($('.composer-voice-time').dataset.countdown, 'false');
  view.unmount();

  // 转写：留在胶囊里，不能完成
  view = mount(toolbar({phase: 'transcribing'}));
  assert.equal(toolbarEl().dataset.mode, 'sheet');
  assert.ok(textOf('.composer-voice-status').includes('正在转写'));
  assert.ok(!byLabel('完成录音'), '转写中不能完成');
  view.unmount();

  // 失败：行内提示，重试与丢弃
  const retry = counter('retry');
  view = mount(toolbar({phase: 'error', error: '麦克风无响应'}, {onRetry: retry, onCancel: counter('discard')}));
  assert.equal(toolbarEl().dataset.mode, 'inline');
  assert.equal(sheetEl().dataset.open, 'false', '失败不展开胶囊');
  assert.equal(textOf('[role="alert"]'), '麦克风无响应');
  byText('重试').click();
  byText('丢弃').click();
  assert.equal(counted.retry, 1, '重试触发重试');
  assert.equal(counted.discard, 1, '丢弃触发取消');
  view.unmount();

  // 确认远程：说明计费，使用远程或改用本地
  view = mount(toolbar({phase: 'confirm'}));
  assert.equal(toolbarEl().dataset.mode, 'inline');
  assert.ok(textOf('[role="status"]').includes('录音将上传至 DeepSeek，按时长计费。'));
  assert.ok(byText('使用远程') && byText('改用本地'));
  view.unmount();

  // 准备中：配置远程服务入口，麦克风在未就绪时禁用
  view = mount(toolbar({phase: 'setup', readyToRecord: false}));
  assert.equal(toolbarEl().dataset.mode, 'inline');
  assert.ok(byText('配置远程服务'), '远程准备可配置');
  assert.equal(byLabel('开始录音').disabled, true, '未就绪时麦克风禁用');
  view.unmount();

  // 本地准备：不显示远程配置入口，本地准备内容插入行内
  view = mount(toolbar({phase: 'local-setup', readyToRecord: true, localSetup: React.createElement('span', {className: 'local-probe'}, '本地准备')}));
  assert.ok(!byText('配置远程服务'), '本地准备没有远程入口');
  assert.ok($('.local-probe'), '本地准备内容插入');
  assert.equal(byLabel('开始录音').disabled, false, '就绪后麦克风可用');
  view.unmount();
}

const counted = {};
function counter(name) {
  counted[name] = 0;
  return () => {counted[name] += 1;};
}

function checkAnchorAndWidth() {
  stageWidth = 0;
  let view = mount(toolbar({phase: 'idle'}));
  assert.equal(sheetEl().style.width, '32px', '收起时宽度回到麦克风');
  view.unmount();

  stageWidth = 180;
  view = mount(toolbar({phase: 'recording', seconds: 3}));
  assert.equal(sheetEl().style.width, '180px', '展开宽度取舞台的自然宽度');
  assert.ok(liveObserver(), '展开时监听内容尺寸');

  // 内容变宽（如计时位数变化）时跟随
  stageWidth = 220;
  act(() => {liveObserver().callback();});
  assert.equal(sheetEl().style.width, '220px', '内容变化时宽度跟随');

  // 内容很窄时不小于麦克风宽度
  stageWidth = 20;
  view.update(toolbar({phase: 'permission'}));
  act(() => {liveObserver().callback();});
  assert.equal(sheetEl().style.width, '32px', '窄内容不小于占位宽度');

  // 收起后停止监听并回到麦克风宽度
  stageWidth = 180;
  view.update(toolbar({phase: 'idle'}));
  assert.equal(sheetEl().style.width, '32px', '收起后回到占位宽度');
  assert.equal(observers.filter(item => !item.disconnected).length, 0, '收起后断开观察');
  view.unmount();
  stageWidth = 0;
}

function checkLeavingLayer() {
  reduceMotion = false;
  let view = mount(toolbar({phase: 'idle'}));
  view.update(toolbar({phase: 'recording', seconds: 5}));
  assert.ok(!$('[data-leaving="true"]'), '从收起到展开没有淡出层');

  // 录音 → 转写：上一层留在胶囊里淡出，新层淡入
  view.update(toolbar({phase: 'transcribing'}));
  const leaving = $('[data-leaving="true"]');
  assert.ok(leaving, '切换阶段时保留上一层');
  assert.ok(leaving.hasAttribute('inert') && leaving.getAttribute('aria-hidden') === 'true', '淡出层不可交互');
  assert.ok(leaving.textContent.includes('正在录音'), '淡出层是录音内容');
  assert.ok(textOf('.composer-voice-layer:not([data-leaving])').includes('正在转写'), '新层是转写内容');

  // 子元素的动画结束不清理，只有淡出层自身结束才移除
  animationEnd(leaving, leaving.querySelector('.composer-voice-time'));
  assert.ok($('[data-leaving="true"]'), '子元素动画结束不清理淡出层');
  animationEnd(leaving);
  assert.ok(!$('[data-leaving="true"]'), '淡出层动画结束后移除');

  // 转写 → 收起：收回时内容同步淡出
  view.update(toolbar({phase: 'idle'}));
  assert.ok(textOf('[data-leaving="true"]').includes('正在转写'), '收回时转写内容淡出');
  view.unmount();

  // 录音 → 失败（收起后显示行内错误）
  view = mount(toolbar({phase: 'recording', seconds: 5}));
  view.update(toolbar({phase: 'error', error: '转写失败'}));
  assert.ok(textOf('[data-leaving="true"]').includes('正在录音'), '失败前的录音内容淡出');
  assert.equal(textOf('[role="alert"]'), '转写失败', '失败提示行内出现');
  view.unmount();

  // 减少动态效果：不保留上一层，内容直接切换
  reduceMotion = true;
  view = mount(toolbar({phase: 'recording', seconds: 3}));
  view.update(toolbar({phase: 'transcribing'}));
  assert.ok(!$('[data-leaving]'), '减少动态效果时不保留淡出层');
  assert.ok(textOf('.composer-voice-layer').includes('正在转写'), '内容直接切换');
  view.update(toolbar({phase: 'idle'}));
  assert.ok(!$('[data-leaving]'), '减少动态效果时收起也不保留');
  view.unmount();
  reduceMotion = false;
}

function checkFlashHighlight() {
  const style = document.createElement('style');
  style.textContent = ':root { --motion-slow: 460ms; --motion-ease: cubic-bezier(.22, .8, .3, 1); }';
  document.head.appendChild(style);
  const field = document.createElement('textarea');
  document.body.appendChild(field);
  const calls = [];
  field.animate = (frames, options) => {calls.push({frames, options}); return {};};

  reduceMotion = false;
  motion.flashHighlight(field);
  assert.equal(calls.length, 1, '未减少动效时回填高亮');
  assert.equal(calls[0].options.duration, 920, '时长取慢档的两倍');
  assert.deepEqual(calls[0].frames[0], {backgroundColor: 'var(--signal-soft)'}, '从弱强调色开始');
  assert.deepEqual(calls[0].frames[1], {backgroundColor: 'transparent'}, '淡回透明');

  reduceMotion = true;
  motion.flashHighlight(field);
  assert.equal(calls.length, 1, '减少动态效果时不高亮');
  reduceMotion = false;

  motion.flashHighlight(null);
  motion.flashHighlight(document.createElement('div'));
  assert.equal(calls.length, 1, '空节点与不支持 WAAPI 的环境不抛错、不动画');

  style.remove();
  field.remove();
}

function checkSettingsRows() {
  const changes = [];
  const probe = React.createElement('span', {className: 'local-probe'}, '本地状态');
  const render = voice => mount(React.createElement(VoiceSettingRow, {
    voice, remote: {phase: 'unconfigured'}, localModel: probe, onChange: value => changes.push(value),
  }));
  const bodyState = id => $(`#${id}`)?.closest('.ui-collapsible-body')?.dataset.state;
  const segment = label => $$('[role="radio"]').find(node => node.textContent.trim() === label);

  let view = render(null);
  assert.ok($('#voice-provider').textContent.includes('语音转文字'), '标题保持语音转文字');
  assert.equal(bodyState('voice-local-model'), 'closed');
  assert.equal(bodyState('voice-remote-service'), 'closed');
  view.unmount();

  view = render('local');
  assert.equal(bodyState('voice-local-model'), 'open', '本地展开本地子行');
  assert.equal(bodyState('voice-remote-service'), 'closed', '本地时远程子行收起');
  assert.equal(segment(VOICE_OPTIONS.local.label).getAttribute('aria-checked'), 'true');
  assert.ok($('.local-probe'), '本地模型状态挂载在本地子行');
  view.unmount();

  view = render('deepseek');
  assert.equal(bodyState('voice-remote-service'), 'open', '远程展开远程子行');
  assert.equal(bodyState('voice-local-model'), 'closed', '远程时本地子行收起');
  assert.equal(segment('远程').getAttribute('aria-checked'), 'true');
  view.unmount();

  view = render('off');
  assert.equal(bodyState('voice-local-model'), 'closed');
  assert.equal(bodyState('voice-remote-service'), 'closed');
  assert.equal(segment('关闭').getAttribute('aria-checked'), 'true');
  view.unmount();

  // 切换分段：远程映射为 deepseek 偏好
  view = render('local');
  act(() => {segment('远程').click();});
  assert.equal(changes.at(-1), 'deepseek', '选远程写入 deepseek 偏好');
  view.unmount();
}

function checkStyles() {
  const css = fs.readFileSync(path.join(root, 'src/components/voice-input.css'), 'utf8');
  const code = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = selector => {
    const start = code.indexOf(`${selector} {`);
    assert.ok(start >= 0, `缺少样式规则 ${selector}`);
    return code.slice(start, code.indexOf('}', start));
  };
  const base = rule('.composer-voice-sheet');
  const open = rule('.composer-voice-sheet[data-open="true"]');
  assert.ok(base.includes('var(--motion-ease)') && !base.includes('spring'), '收回用缓出，不用弹性');
  assert.ok(open.includes('width var(--motion-slow) var(--motion-spring)'), '展开宽度用弹性曲线与慢档');
  assert.ok(rule('.composer-voice-stage').includes('width: max-content'), '舞台按内容自然宽度测量');
  assert.ok(rule('.composer-voice-layer[data-leaving="true"]').includes('composer-voice-leave var(--motion-fast)'), '淡出层用快档');
  assert.ok(rule('.composer-voice-enter').includes('composer-voice-enter var(--motion-mid)'), '淡入用中档');

  const reduceStart = code.indexOf('@media (prefers-reduced-motion: reduce)');
  assert.ok(reduceStart >= 0, '缺少减少动态效果分支');
  const reduce = code.slice(reduceStart);
  assert.ok(/\.composer-voice-sheet[^{]*\{[^}]*transition: none/.test(reduce), '减少动效时胶囊不过渡');
  assert.ok(/\.composer-voice-enter[^{]*\{[^}]*animation: none/.test(reduce), '减少动效时不淡入');
  assert.ok(/\[data-leaving="true"\]\s*\{\s*display: none/.test(reduce), '减少动效时淡出层不保留');

  const raw = code.match(/\b\d+(?:\.\d+)?m?s\b/g);
  assert.equal(raw, null, `动效时长必须使用 --motion-* token，发现 ${raw?.join(', ')}`);

  const chatInput = fs.readFileSync(path.join(root, 'src/components/chat-input.tsx'), 'utf8');
  assert.ok(chatInput.includes('flashHighlight(field)'), '回填后调用高亮');
}

// 矩形替身：胶囊按当前宽度占据从 100 开始的区域；其余元素读取 data-test-rect（left,top,width,height）。
const rectOf = (left, top, width, height) => ({left, top, width, height, right: left + width, bottom: top + height, x: left, y: top});
window.Element.prototype.getBoundingClientRect = function () {
  if (this.classList?.contains('composer-voice-sheet')) return rectOf(100, 0, parseFloat(this.style.width) || 0, 32);
  if (this.dataset?.testRect) return rectOf(...this.dataset.testRect.split(',').map(Number));
  return rectOf(0, 0, 0, 0);
};

function composer(props) {
  return React.createElement('footer', {className: 'composer-actions'},
    React.createElement('div', {className: 'composer-input-actions'},
      React.createElement('button', {type: 'button', className: 'composer-attach', 'aria-label': '添加附件', 'data-test-rect': '0,0,32,32'}),
      toolbar(props),
      React.createElement('div', {className: 'composer-shortcuts', 'data-test-rect': '200,0,64,32'},
        React.createElement('button', {type: 'button', 'aria-label': '命令与 Skill'}),
        React.createElement('button', {type: 'button', 'aria-label': '计划模式'}))),
    React.createElement('div', {className: 'composer-submit-actions', 'data-test-rect': '400,0,80,32'},
      React.createElement('button', {type: 'button', 'aria-label': '发送'})));
}

function checkCoveredSiblings() {
  const shortcuts = () => $('.composer-shortcuts');
  const covered = node => node.hasAttribute('inert') && node.getAttribute('aria-hidden') === 'true' && node.hasAttribute('data-voice-covered');
  const free = node => !node.hasAttribute('inert') && !node.hasAttribute('aria-hidden') && !node.hasAttribute('data-voice-covered');

  stageWidth = 120;
  let view = mount(composer({phase: 'idle'}));
  assert.ok(free(shortcuts()), '空闲时没有按钮被盖住');
  // 焦点在快捷按钮上时开始录音：焦点必须移到胶囊，不能停在看不见的按钮上
  $('[aria-label="计划模式"]').focus();
  view.update(composer({phase: 'recording', seconds: 3}));
  assert.ok(covered(shortcuts()), '录音时与胶囊相交的快捷按钮被盖住');
  assert.ok(free($('.composer-attach')), '胶囊左侧的附件按钮不被盖住');
  assert.ok(free($('.composer-submit-actions')), '胶囊之外的发送组不被盖住');
  assert.ok(sheetEl().contains(document.activeElement), '焦点移到胶囊内，不停在被盖住的按钮上');
  assert.ok(!shortcuts().contains(document.activeElement), '被盖住的按钮不持有焦点');

  // 转写中仍然盖住；行内失败时胶囊收起，按钮恢复
  view.update(composer({phase: 'transcribing'}));
  assert.ok(covered(shortcuts()), '转写中仍盖住快捷按钮');
  view.update(composer({phase: 'error', error: '转写失败'}));
  assert.ok(free(shortcuts()), '失败后胶囊收起，快捷按钮恢复');
  view.unmount();

  // 宽度变化：胶囊变宽时发送组也被盖住，变窄后恢复
  stageWidth = 320;
  view = mount(composer({phase: 'recording', seconds: 3}));
  assert.ok(covered($('.composer-submit-actions')), '胶囊延伸到发送组时发送组被盖住');
  stageWidth = 40;
  act(() => {liveObserver().callback();});
  assert.ok(free($('.composer-submit-actions')), '胶囊变窄后发送组恢复');
  assert.ok(free(shortcuts()), '胶囊变窄后快捷按钮恢复');

  // 收起：全部恢复
  view.update(composer({phase: 'idle'}));
  assert.equal($$('[data-voice-covered]').length, 0, '收起后没有残留的盖住标记');
  assert.ok(free(shortcuts()));
  view.unmount();
  stageWidth = 0;

  // 样式：盖住的组淡出，淡入淡出用快档缓出；减少动态效果时直接切换
  const css = fs.readFileSync(path.join(root, 'src/components/voice-input.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(/\[data-voice-covered\]\s*\{\s*opacity: 0;\s*\}/.test(css), '盖住的组淡出到不可见');
  assert.ok(/\.composer-input-actions > \*, \.composer-actions > \.composer-submit-actions \{ transition: opacity var\(--motion-fast\) var\(--motion-ease\); \}/.test(css), '淡入淡出用快档缓出');
  const reduce = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
  assert.ok(/\.composer-input-actions > \*, \.composer-actions > \.composer-submit-actions \{ transition: none; \}/.test(reduce), '减少动态效果时盖住组直接切换');
}

function checkCollapsibleSwitch() {
  const changes = [];
  const probe = React.createElement('span', {className: 'local-probe'}, '本地状态');
  const settings = voice => React.createElement(VoiceSettingRow, {
    voice, remote: {phase: 'unconfigured'}, localModel: probe, onChange: value => changes.push(value),
  });
  const body = id => $(`#${id}`).closest('.ui-collapsible-body');
  const view = mount(settings('local'));
  const localBody = body('voice-local-model');
  const remoteBody = body('voice-remote-service');
  assert.equal(localBody.dataset.state, 'open');
  // 切换时同一节点原地改变状态（不重新挂载），过渡才会发生
  view.update(settings('deepseek'));
  assert.ok(body('voice-local-model') === localBody, '切换后本地子行是同一个节点');
  assert.ok(body('voice-remote-service') === remoteBody, '切换后远程子行是同一个节点');
  assert.equal(localBody.dataset.state, 'closed', '本地子行收起');
  assert.equal(remoteBody.dataset.state, 'open', '远程子行展开');
  assert.ok(localBody.hasAttribute('inert') && !remoteBody.hasAttribute('inert'), '收起的子行不可交互');
  view.unmount();

  const globals = fs.readFileSync(path.join(root, 'src/globals.css'), 'utf8');
  const collapsedRule = globals.slice(globals.indexOf('.ui-collapsible-body[data-state="closed"]'));
  assert.ok(/grid-template-rows var\(--motion-mid\) var\(--motion-ease\)/.test(collapsedRule.slice(0, 400)), '收起用缓出过渡行高');
  assert.ok(/\.ui-collapsible-body\s*\{[^}]*grid-template-rows var\(--motion-mid\) var\(--motion-spring\)/.test(globals), '展开用弹性过渡行高');
}

function main() {
  checkPhases();
  checkAnchorAndWidth();
  checkLeavingLayer();
  checkFlashHighlight();
  checkSettingsRows();
  checkCollapsibleSwitch();
  checkCoveredSiblings();
  checkStyles();
  console.log('PASS: voice toolbar phases, sheet anchor and width, leaving layer and reduced-motion branches, highlight, settings collapsible rows, and motion tokens are checked');
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
