/* eslint-disable @typescript-eslint/no-require-imports */
// 模型提供商编辑器检查：挂载实际的编辑器与模型列表，替换网络与界面基础组件。
// 覆盖：目录只读、上游与自定义模型的启用、保存分类、claimed_by 占用、核心按模型返回的错误、工具检测三种结论、思考档位、目录未就绪。
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const React = require('react');
const {act, create} = require('react-test-renderer');
const {createLoader} = require('./workspace-loader.cjs');

const root = path.resolve(__dirname, '..');
global.IS_REACT_ACT_ENVIRONMENT = true;

class ApiError extends Error {
  constructor(status, info) {
    super(info.message);
    this.status = status;
    this.code = info.code;
    this.details = info.details ?? {};
    this.retryable = info.retryable ?? false;
  }
}

const ui = new Proxy({}, {
  get: (_, name) => (props) => React.createElement(name === 'Button' ? 'button' : name === 'Input' ? 'input' : 'div',
    {...props, 'data-component': name}, props.children),
});
const stubs = {
  sonner: {toast: {success() {}, error() {}}},
  '@/components/vendor-icon': {VendorIcon: () => null},
  '@/components/ui/icons': new Proxy({}, {get: () => () => null}),
  '@/components/ui/button': {Button: React.forwardRef((props, ref) => React.createElement('button', {...props, ref}, props.children))},
  '@/components/ui/input': {Input: (props) => React.createElement('input', props)},
  '@/components/ui/collapsible': {
    Collapsible: (props) => React.createElement('div', null, props.children),
    CollapsibleTrigger: (props) => props.children,
    CollapsibleContent: (props) => React.createElement('div', {className: props.className}, props.children),
    collapsibleChevron: '',
  },
  '@/lib/api/fetch': {ApiError},
  '@/lib/api/model-connections': {modelConnectionsApi: {}},
  '@/lib/utils': {cn: (...values) => values.filter(Boolean).join(' ')},
  '@/components/ui/level-slider': {LevelSlider: () => null},
};
for (const name of ['@/components/ui/select', '@/components/ui/switch']) stubs[name] = ui;
const load = createLoader(stubs);
const editorModule = load('src/components/settings/provider-editor.tsx');
const listModule = load('src/components/settings/provider-model-list.tsx');
const modelsModule = load('src/components/settings/provider-models.ts');

const CATALOG = [
  catalog('deepseek-flash', 'deepseek', 'DeepSeek', 1_000_000, 393_216, ['high', 'max'], true),
  catalog('deepseek-v4-pro', 'deepseek', 'DeepSeek', 1_000_000, 393_216, ['high'], true),
  catalog('gpt-6-astra', 'openai', 'OpenAI', 128_000, 16_000, [], true),
];
function catalog(id, vendor, vendorLabel, context_window, max_output, efforts, priced) {
  return {
    id, vendor, vendor_label: vendorLabel, tools: true, vision: false, context_window, max_output,
    choices: ['none', ...efforts], default_choice: efforts[0] ?? 'none',
    reasoning_options: [{id: 'none', enabled: false}, ...efforts.map(effort => ({id: effort, enabled: true}))],
    reasoning_ordered: false, reasoning_family: null, temperature_when: 'always', temperature_max: null,
    rates: priced ? {input: '0.30', cached_input: '0.05', output: '1.20'} : null, has_builtin_pricing: priced,
  };
}
const UPSTREAM = [
  {id: 'deepseek-flash', catalog: true, context_window: 1_000_000, max_output: 393_216, tools: true, vision: false, thinking: true,
    reasoning_efforts: ['high', 'max'], rates: null, sources: {context_window: 'catalog'}},
  {id: 'example-text', catalog: false, context_window: 65_536, max_output: 4_096, tools: true, vision: false, thinking: false,
    reasoning_efforts: [], rates: null, sources: {context_window: 'upstream', max_output: 'unconfirmed', tools: 'unconfirmed', vision: 'unconfirmed', thinking: 'unconfirmed'}},
  {id: 'example-code:latest', catalog: false, context_window: 32_000, max_output: 4_096, tools: true, vision: false, thinking: false,
    reasoning_efforts: [], rates: null, sources: {context_window: 'unconfirmed', max_output: 'unconfirmed', tools: 'unconfirmed', vision: 'unconfirmed', thinking: 'unconfirmed'}},
  {id: 'example-long', catalog: false, context_window: 32_000, max_output: 4_096, tools: true, vision: false, thinking: false,
    reasoning_efforts: [], rates: null, sources: {context_window: 'unconfirmed', max_output: 'unconfirmed', tools: 'unconfirmed', vision: 'unconfirmed', thinking: 'unconfirmed'}},
  {id: 'example-lite', catalog: false, claimed_by: 'other', context_window: 131_072, max_output: 8_192, tools: true, vision: false, thinking: false,
    reasoning_efforts: [], rates: null, sources: {context_window: 'upstream', max_output: 'upstream', tools: 'upstream', vision: 'upstream', thinking: 'upstream'}},
];

function fakeApi({details = UPSTREAM, saveError, toolResult} = {}) {
  const calls = {save: [], toolCheck: []};
  const api = {
    catalog: async () => ({price_version: 'check', models: CATALOG}),
    models: async () => ({status: 200, elapsed_ms: 5, method: 'models', models: details.map(item => item.id), model_details: details}),
    test: async () => ({status: 200, elapsed_ms: 1, method: 'request'}),
    toolCheck: async body => {
      calls.toolCheck.push(body);
      if (toolResult) return toolResult(body.model);
      return {supported: true, elapsed_ms: 2};
    },
    save: async (name, body) => {
      calls.save.push({name, body});
      if (saveError) throw saveError;
      return {path: 'config.toml', exists: true, version: 'b', providers: []};
    },
    get: async () => ({path: 'config.toml', exists: true, version: 'a', providers: []}),
    remove: async () => ({path: 'config.toml', exists: true, version: 'b', providers: []}),
  };
  return {api, calls};
}

const flush = () => new Promise(resolve => setImmediate(resolve));
async function mount(api, prior, catalogModels = CATALOG, catalogError = null, onRetryCatalog = () => {}) {
  const editor = editorModule.openProvider(api, 'a', prior);
  let renderer;
  await act(async () => {
    renderer = create(React.createElement(editorModule.ProviderEditor, {
      editor, taken: [], api, catalog: catalogModels, catalogError, onRetryCatalog,
      onClose() {}, onSaved() {}, onDirtyChange() {},
    }));
  });
  await act(async () => {await flush();});
  return renderer;
}

const rowOf = (renderer, id) => renderer.root.findAll(node => node.type === 'li'
  && node.findAll(child => child.type === 'code' && child.children.includes(id)).length > 0)[0];
const rowOrder = renderer => renderer.root.findAll(node => node.type === 'li').map(node => node.findAll(child => child.type === 'code')[0]?.children[0]);
const checkboxOf = (renderer, id) => rowOf(renderer, id).findAll(node => node.type === 'input' && node.props.type === 'checkbox')[0];
const buttonIn = (scope, text) => scope.findAll(node => node.type === 'button' && node.children.some(child => typeof child === 'string' && child.startsWith(text)))[0];
function textOf(node) {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (typeof node.toJSON === 'function') return textOf(node.toJSON());
  return textOf(node.children);
}
const text = node => textOf(node);
const saveButton = renderer => renderer.root.findAll(node => node.type === 'button' && node.props.type === 'submit')[0];

async function toggle(renderer, id) {
  await act(async () => {checkboxOf(renderer, id).props.onChange({target: {checked: true}});});
}
async function submit(renderer) {
  await act(async () => {renderer.root.findByType('form').props.onSubmit({preventDefault() {}});});
  await act(async () => {await flush();});
}
async function type(renderer, node, value) {
  await act(async () => {node.props.onChange({target: {value}});});
}
const lastSave = calls => calls.save.at(-1).body;

const priorUnread = {
  name: 'gateway', kind: 'compatible', base_url: 'https://gw.example.test/v1', api_protocol: 'chat_completions', requires_key: true,
  has_key: false, key_hint: null, models: ['gpt-6-astra', 'my-gpt'], configured_models: ['gpt-6-astra'],
  custom_models: {'my-gpt': {context_window: 128_000, max_output: 8_000, tools: true, vision: false, thinking: false}},
};

const priorGateway = {
  name: 'gateway', kind: 'compatible', base_url: 'https://gw.example.test/v1', api_protocol: 'chat_completions', requires_key: true,
  has_key: true, key_hint: '••••0001', models: ['deepseek-flash', 'my-gpt'], configured_models: ['deepseek-flash'],
  custom_models: {'my-gpt': {context_window: 128_000, max_output: 8_000, tools: true, vision: false, thinking: false, unconfirmed: ['vision']}},
};

async function main() {
  // 静态：硬编码目录已删除，设置页不再携带模型能力或单价
  assert.ok(!fs.existsSync(path.join(root, 'src/components/settings/provider-catalog.ts')), '硬编码目录文件已删除');
  for (const file of ['components/settings/provider-presets.ts', 'components/settings/provider-models.ts', 'components/settings/provider-model-list.tsx', 'components/settings/provider-editor.tsx', 'components/settings/model-connections.tsx']) {
    const source = fs.readFileSync(path.join(root, 'src', file), 'utf8');
    assert.ok(!/knownModels|provider-catalog|deepseek-v4-pro|gpt-6/.test(source), `${file} 不应写死模型 ID 或能力`);
  }

  // 目录未就绪：不显示可编辑列表，保存禁用
  {
    const {api} = fakeApi();
    const renderer = await mount(api, undefined, null, null);
    assert.ok(text(renderer).includes('正在读取内置目录'));
    assert.equal(renderer.root.findAll(node => node.props['aria-label'] === '模型列表').length, 0);
    assert.equal(saveButton(renderer).props.disabled, true);
  }

  // 目录读取失败：仍可保存地址与已启用模型；已保存的目录模型按原归类提交，能力以核心结果为准；可重试
  {
    let retries = 0;
    const {api, calls} = fakeApi();
    const renderer = await mount(api, priorUnread, null, '网络不可用', () => {retries += 1;});
    assert.ok(text(renderer).includes('内置目录未读取（网络不可用）'), '列表处提示目录未读取');
    assert.equal(renderer.root.findAll(node => node.props['aria-label'] === '模型列表').length, 1, '失败时仍显示模型列表');
    const unread = rowOf(renderer, 'gpt-6-astra');
    assert.ok(text(unread).includes('目录未读取，能力以核心保存结果为准'), '已保存模型的能力标为未读取');
    assert.equal(unread.findAll(node => node.type === 'input' && node.props['aria-label']?.startsWith('输出单价')).length, 0, '未读取的模型不可编辑');
    assert.equal(saveButton(renderer).props.disabled, false, '目录读取失败时仍可保存');
    await act(async () => {buttonIn(renderer.root, '重试').props.onClick();});
    assert.equal(retries, 1, '重试触发一次目录读取');
    await submit(renderer);
    const body = lastSave(calls);
    assert.deepEqual(body.models, ['gpt-6-astra'], '已保存的目录模型按原归类提交');
    assert.deepEqual(Object.keys(body.custom_models), ['my-gpt'], '目录外模型保留自定义声明');
    assert.equal(body.custom_models['my-gpt'].context_window, 128000);
  }

  // 目录行只读：能力与单价来自目录，不出现输入框，启用后只写 ID
  {
    const {api, calls} = fakeApi();
    const renderer = await mount(api, undefined, CATALOG, null);
    assert.ok(rowOf(renderer, 'deepseek-flash'), '目录模型出现在对应厂商的类型中');
    assert.equal(rowOf(renderer, 'gpt-6-astra'), undefined, '其他厂商的目录模型不出现在 DeepSeek 类型中');
    assert.ok(text(rowOf(renderer, 'deepseek-flash')).includes('$0.30 / $1.20'));
    assert.ok(text(rowOf(renderer, 'deepseek-flash')).includes('能力与单价由内置目录提供'));
    assert.equal(rowOf(renderer, 'deepseek-flash').findAll(node => node.type === 'input' && node.props['aria-label']?.startsWith('输出单价')).length, 0);
    await toggle(renderer, 'deepseek-flash');
    await submit(renderer);
    assert.deepEqual(lastSave(calls).models, ['deepseek-flash']);
    assert.deepEqual(lastSave(calls).custom_models, {});
  }

  // 上游未确认能力：启用后带 unconfirmed 保存；显示能力未确认；claimed_by 不能启用
  {
    const {api, calls} = fakeApi();
    const renderer = await mount(api, priorGateway);
    assert.ok(text(rowOf(renderer, 'example-text')).includes('能力未确认'), '未确认的上游模型显示能力未确认');
    assert.ok(!text(rowOf(renderer, 'deepseek-flash')).includes('能力未确认'), '目录模型不显示能力未确认');
    assert.equal(checkboxOf(renderer, 'example-lite').props.disabled, true, '已被其他提供商占用的模型不能启用');
    assert.ok(text(rowOf(renderer, 'example-lite')).includes('已由 other 提供'), '占用方显示在模型行');
    await act(async () => {checkboxOf(renderer, 'example-lite').props.onChange({target: {checked: true}});});
    await toggle(renderer, 'example-text');
    await submit(renderer);
    const body = lastSave(calls);
    assert.ok(!body.models.includes('example-lite') && !body.custom_models['example-lite'], '占用模型不随保存提交');
    assert.deepEqual(body.custom_models['example-text'].unconfirmed, ['max_output', 'tools', 'vision', 'thinking'], '保存时带上未确认字段');
    assert.equal(body.custom_models['example-text'].context_window, 65536);
    assert.deepEqual(body.models, ['deepseek-flash']);
    assert.ok(body.custom_models['my-gpt'], '已保存的目录外模型保留');
    assert.deepEqual(body.custom_models['my-gpt'].unconfirmed, ['vision'], '已保存的未确认字段随配置读回');
  }

  // 编辑思考档位与确认：添加档位后 thinking 视为已确认；非法档位只在本行提示且不能保存
  {
    const {api, calls} = fakeApi();
    const renderer = await mount(api, priorGateway);
    await toggle(renderer, 'example-text');
    const effortInput = () => rowOf(renderer, 'example-text').findAll(node => node.type === 'input' && node.props['aria-label'] === '添加思考档位')[0];
    const addEffort = async value => {
      await type(renderer, effortInput(), value);
      await act(async () => {effortInput().props.onKeyDown({key: 'Enter', keyCode: 13, nativeEvent: {isComposing: false}, preventDefault() {}});});
    };
    await addEffort('high');
    await addEffort('enabled');
    assert.ok(text(rowOf(renderer, 'example-text')).includes('思考档位不能使用 enabled'), '保留字在本行提示，不写入草稿');
    await addEffort('low');
    assert.ok(!text(rowOf(renderer, 'example-text')).includes('思考档位不能使用 enabled'), '改正输入后提示消失');
    await submit(renderer);
    const body = lastSave(calls);
    assert.deepEqual(body.custom_models['example-text'].reasoning_efforts, ['high', 'low']);
    assert.equal(body.custom_models['example-text'].thinking, true);
    assert.ok(!body.custom_models['example-text'].unconfirmed.includes('thinking'), '编辑档位即确认思考');
  }

  // 核心按模型返回的错误：定位到对应行
  {
    const error = new ApiError(400, {code: 'bad_request', message: '模型 acme-bad 的 context_window 无效：须大于 1',
      details: {models: {'acme-bad': '模型 acme-bad 的 context_window 无效：须大于 1'}}});
    const {api} = fakeApi({saveError: error});
    const renderer = await mount(api, priorGateway);
    await type(renderer, renderer.root.findAll(node => node.type === 'input' && node.props['aria-label'] === '手动添加模型 ID')[0], 'acme-bad');
    await act(async () => {buttonIn(renderer.root, '添加模型').props.onClick();});
    await submit(renderer);
    assert.ok(text(rowOf(renderer, 'acme-bad')).includes('模型 acme-bad 的 context_window 无效：须大于 1'), '字段错误显示在模型行');
  }
  {
    const error = new ApiError(400, {code: 'bad_request', message: '模型 deepseek-flash 已由 other 提供。',
      details: {models: {'deepseek-flash': '已由 other 提供'}}});
    const {api} = fakeApi({saveError: error});
    const renderer = await mount(api, priorGateway);
    await submit(renderer);
    assert.ok(text(rowOf(renderer, 'deepseek-flash')).includes('已由 other 提供'), '重复归属显示在对应模型行');
  }

  // 工具检测三种结论：支持确认；拒绝只给原因与「关闭工具」，由用户确认后才关闭；失败保留原值并可重试
  {
    const {api, calls} = fakeApi({toolResult: model => model === 'example-code:latest'
      ? {supported: false, elapsed_ms: 3, upstream_status: 400, reason: 'tools is not supported by this model', suggestion: null}
      : {supported: true, elapsed_ms: 2}});
    const renderer = await mount(api, priorGateway);
    await toggle(renderer, 'example-text');
    await toggle(renderer, 'example-code:latest');
    await act(async () => {buttonIn(rowOf(renderer, 'example-text'), '检测').props.onClick();});
    await act(async () => {await flush();});
    assert.ok(text(rowOf(renderer, 'example-text')).includes('已确认支持工具调用'));
    await act(async () => {buttonIn(rowOf(renderer, 'example-code:latest'), '检测').props.onClick();});
    await act(async () => {await flush();});
    const rejected = text(rowOf(renderer, 'example-code:latest'));
    assert.ok(rejected.includes('上游不接受工具定义（HTTP 400）：tools is not supported by this model'), '行内说明原因与 HTTP 状态');
    assert.ok(!rejected.includes('已关闭工具调用'), '拒绝结论不自动关闭工具');
    assert.ok(buttonIn(rowOf(renderer, 'example-code:latest'), '关闭工具'), '提供关闭工具按钮');
    await submit(renderer);
    assert.equal(lastSave(calls).custom_models['example-code:latest'].tools, true, '未确认前工具开关保持原值');
    assert.ok(lastSave(calls).custom_models['example-code:latest'].unconfirmed.includes('tools'), '未确认前仍标为未确认');
    await act(async () => {buttonIn(rowOf(renderer, 'example-code:latest'), '关闭工具').props.onClick();});
    assert.ok(text(rowOf(renderer, 'example-code:latest')).includes('已关闭工具调用'), '用户确认后关闭');
    await submit(renderer);
    const body = lastSave(calls);
    assert.equal(body.custom_models['example-code:latest'].tools, false, '确认后保存为关闭工具');
    assert.ok(!body.custom_models['example-code:latest'].unconfirmed.includes('tools'), '确认后视为已确认');
    assert.equal(body.custom_models['example-text'].tools, true);
    assert.deepEqual(calls.toolCheck.map(item => item.model), ['example-text', 'example-code:latest']);
    assert.equal(calls.toolCheck[0].custom_models['example-text'].tools, true, '检测请求使用当前草稿');
  }
  {
    const failure = new ApiError(404, {code: 'unavailable', message: '工具能力检测未能完成：上游找不到该模型或接口地址不正确，请检查模型 ID 与地址。（x）',
      details: {upstream_status: 404}});
    const {api} = fakeApi({toolResult: () => {throw failure;}});
    const renderer = await mount(api, priorGateway);
    await toggle(renderer, 'example-long');
    await act(async () => {buttonIn(rowOf(renderer, 'example-long'), '检测').props.onClick();});
    await act(async () => {await flush();});
    const note = text(rowOf(renderer, 'example-long'));
    assert.ok(note.includes('找不到该模型或接口地址不正确'), '失败给出原因');
    assert.ok(note.includes('可再次检测'), '失败可重试');
    assert.ok(!note.includes('不接受工具定义') && !note.includes('已关闭工具调用') && !note.includes('关闭工具'), '失败不能下不支持工具的结论，也不提供关闭操作');
    assert.ok(note.includes('能力未确认'), '失败后能力仍未确认');
  }

  // 本地校验：价格不完整时只在本行提示
  {
    const {api} = fakeApi();
    const renderer = await mount(api, priorGateway);
    await toggle(renderer, 'example-text');
    const rateInput = rowOf(renderer, 'example-text').findAll(node => node.type === 'input' && node.props['aria-label'] === '输出单价（美元，每百万 Token）')[0];
    await type(renderer, rateInput, '0.5');
    assert.ok(text(rowOf(renderer, 'example-text')).includes('请同时填写有效的输入和输出单价'));
    assert.equal(saveButton(renderer).props.disabled, true);
  }

  // 列表顺序与启用切换不变：切换不改变行的先后，不发生重排
  {
    const {api} = fakeApi();
    const renderer = await mount(api, priorGateway);
    const before = rowOrder(renderer);
    await toggle(renderer, 'example-text');
    await toggle(renderer, 'example-long');
    assert.deepEqual(rowOrder(renderer), before, '切换启用不改变行顺序');
  }

  // 长列表搜索过滤
  {
    const many = Array.from({length: 10}, (_, index) => ({
      id: `bulk-${String(index + 1).padStart(2, '0')}`, catalog: false, context_window: 32_000, max_output: 4_096, tools: true, vision: false,
      thinking: false, reasoning_efforts: [], rates: null, sources: {context_window: 'upstream'},
    }));
    const {api} = fakeApi({details: many});
    const renderer = await mount(api, {name: 'gateway', kind: 'compatible', base_url: 'https://gw.example.test/v1', api_protocol: 'chat_completions',
      requires_key: true, has_key: true, key_hint: '••••', models: [], configured_models: [], custom_models: {}});
    const search = renderer.root.findAll(node => node.type === 'input' && node.props['aria-label'] === '搜索模型')[0];
    await type(renderer, search, '08');
    const visible = renderer.root.findAll(node => node.type === 'li').map(node => node.findAll(child => child.type === 'code')[0]?.children[0]);
    assert.deepEqual(visible, ['bulk-08']);
  }

  // 静态核对：目录模型与设置页的模块边界
  const modelsSource = fs.readFileSync(path.join(root, 'src/components/settings/provider-models.ts'), 'utf8');
  assert.ok(modelsSource.includes('declarationDraft') && modelsSource.includes('unconfirmedKeys'), '目录外模型的保守默认全部标为未确认');
  assert.equal(typeof modelsModule.validateCustom, 'function');
  assert.equal(typeof listModule.ProviderModelList, 'function');

  console.log('PASS: catalog-only models, upstream unconfirmed capabilities, claimed_by blocking, row-level core errors, tool-check outcomes (supported, rejected with user-confirmed close, failed), efforts validation, local price validation, stable row order, long-list search, catalog pending blocks save, catalog failure allows save with retry');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
