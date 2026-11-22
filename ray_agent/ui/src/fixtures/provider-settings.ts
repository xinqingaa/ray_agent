import {ApiError} from '@/lib/api/fetch'
import type {CatalogModel, ProbedModel} from '@/lib/api/model-connections'
import type {ConnectionSource, ProviderStatus} from '@/lib/api/types'
import type {ProviderApi} from '@/components/settings/provider-editor'

const sampleProvider = {
  name: 'deepseek',
  base_url: 'https://api.deepseek.com/',
  api_protocol: 'responses',
  kind: 'deepseek',
  has_key: true,
  requires_key: true,
  key_hint: '••••0000',
  models: ['deepseek-flash', 'example-text'],
  configured_models: ['deepseek-flash'],
  custom_models: {
    'example-text': {
      context_window: 65536, max_output: 4096, tools: true, vision: false, thinking: false,
      rates: {input: '0.30', cached_input: '0.05', output: '1.20'},
    },
  },
} satisfies ProviderStatus

const unavailableProvider: ProviderStatus = {
  name: 'example_offline',
  base_url: 'https://offline.example.test/v1',
  api_protocol: 'chat_completions',
  kind: 'compatible',
  has_key: true,
  requires_key: true,
  key_hint: '••••0001',
  models: ['example-offline'],
  configured_models: [],
  custom_models: {
    'example-offline': {context_window: 131072, max_output: 8192, tools: true, vision: false, thinking: false},
  },
}

const modelIds = [
  'deepseek-flash', 'deepseek-v4-pro', 'example-text', 'example-chat', 'example-code:latest', 'example-long',
  'example-mini', 'example-reasoning', 'example-vision', 'example-fast', 'example-lite',
]

/** 夹具目录：只用于界面检查，数值不代表真实目录。 */
const fixtureCatalog: CatalogModel[] = [
  catalogItem('deepseek-flash', 'deepseek', 'DeepSeek', {context_window: 1_000_000, max_output: 393_216, vision: true, efforts: ['high', 'max']}),
  catalogItem('deepseek-v4-pro', 'deepseek', 'DeepSeek', {context_window: 1_000_000, max_output: 393_216, efforts: ['high', 'max']}),
  catalogItem('gpt-6.1-sol', 'openai', 'OpenAI', {context_window: 400_000, max_output: 128_000, vision: true, efforts: ['low', 'medium', 'high']}),
  catalogItem('gpt-6-luna', 'openai', 'OpenAI', {context_window: 200_000, max_output: 64_000, efforts: ['low', 'high']}),
  catalogItem('gpt-6-astra', 'openai', 'OpenAI', {context_window: 128_000, max_output: 16_000}),
]

function catalogItem(id: string, vendor: string, vendorLabel: string, options: {
  context_window: number; max_output: number; vision?: boolean; efforts?: string[]
}): CatalogModel {
  const efforts = options.efforts ?? []
  return {
    id, vendor, vendor_label: vendorLabel, tools: true, vision: options.vision ?? false,
    context_window: options.context_window, max_output: options.max_output,
    choices: ['none', ...efforts], default_choice: efforts[0] ?? 'none',
    reasoning_options: [{id: 'none', enabled: false}, ...efforts.map(effort => ({id: effort, enabled: true}))],
    reasoning_ordered: efforts.length > 1, reasoning_family: null, temperature_when: 'always', temperature_max: null,
    rates: {input: '0.30', cached_input: '0.05', output: '1.20'}, has_builtin_pricing: id !== 'gpt-6-astra',
  }
}

/** 上游读取结果：来源、能力未确认与占用情况与核心返回一致。 */
const upstreamDetails: ProbedModel[] = [
  {id: 'deepseek-flash', catalog: true, context_window: 1_000_000, max_output: 393_216, tools: true, vision: true, thinking: true,
    reasoning_efforts: ['high', 'max'], rates: null, sources: {context_window: 'catalog', tools: 'catalog'}},
  {id: 'example-text', catalog: false, context_window: 65_536, max_output: 4_096, tools: true, vision: false, thinking: false,
    reasoning_efforts: [], rates: null, sources: {context_window: 'upstream', max_output: 'unconfirmed', tools: 'unconfirmed', vision: 'unconfirmed', thinking: 'unconfirmed'}},
  {id: 'example-code:latest', catalog: false, context_window: 32_000, max_output: 4_096, tools: true, vision: false, thinking: false,
    reasoning_efforts: [], rates: null, sources: {context_window: 'unconfirmed', max_output: 'unconfirmed', tools: 'unconfirmed', vision: 'unconfirmed', thinking: 'unconfirmed'}},
  {id: 'example-lite', catalog: false, claimed_by: 'gateway', context_window: 131_072, max_output: 8_192, tools: true, vision: false, thinking: false,
    reasoning_efforts: [], rates: null, sources: {context_window: 'upstream', max_output: 'upstream', tools: 'upstream', vision: 'upstream', thinking: 'upstream'}},
  {id: 'example-vision', catalog: false, context_window: 131_072, max_output: 8_192, tools: true, vision: true, thinking: false,
    reasoning_efforts: [], rates: null, sources: {context_window: 'upstream', max_output: 'upstream', tools: 'upstream', vision: 'upstream', thinking: 'unconfirmed'}},
]

function fixtureError(code: 'conflict' | 'unavailable' | 'not_found', message: string) {
  return new ApiError(code === 'conflict' ? 409 : code === 'not_found' ? 404 : 503, {
    code, message, retryable: false, retry_after_ms: null, resource_version: null, details: {},
  })
}

function nextVersion(version: string | null | undefined) {
  return version === 'a'.repeat(64) ? 'b'.repeat(64) : 'a'.repeat(64)
}

export function createProviderSettingsFixture() {
  const initial: ConnectionSource = {
    path: '~/RayAgent/config.toml', exists: true, version: 'a'.repeat(64),
    providers: [sampleProvider, unavailableProvider],
  }
  let source = initial
  let conflictOnce = true
  const api: ProviderApi = {
    get: async () => source,
    models: async body => {
      await new Promise(resolve => setTimeout(resolve, 300))
      if (body.name === unavailableProvider.name) throw fixtureError('unavailable', '上游暂时不可用。')
      if (body.base_url === sampleProvider.base_url && !body.api_key && body.name !== sampleProvider.name) {
        throw fixtureError('unavailable', '无法找到已保存的密钥。')
      }
      return {status: 200, elapsed_ms: 120, method: 'models', models: modelIds, model_details: upstreamDetails}
    },
    test: async body => {
      if (!body.model) return api.models(body)
      if (body.name === unavailableProvider.name) throw fixtureError('unavailable', '上游暂时不可用。')
      if (body.base_url === sampleProvider.base_url && !body.api_key && body.name !== sampleProvider.name) {
        throw fixtureError('unavailable', '无法找到已保存的密钥。')
      }
      return {status: 200, elapsed_ms: 186, method: 'request'}
    },
    catalog: async () => ({price_version: 'fixture', models: fixtureCatalog}),
    toolCheck: async body => {
      await new Promise(resolve => setTimeout(resolve, 200))
      const id = body.model ?? ''
      if (id === 'example-long') throw fixtureError('not_found', '工具能力检测未能完成：上游找不到该模型或接口地址不正确，请检查模型 ID 与地址。')
      if (id === 'example-code:latest') return {supported: false, elapsed_ms: 150, upstream_status: 400, reason: 'tools is not supported by this model', suggestion: null}
      return {supported: true, elapsed_ms: 150, upstream_status: null, reason: null, suggestion: null}
    },
    save: async (name, body) => {
      if (name === unavailableProvider.name && conflictOnce) {
        conflictOnce = false
        source = {...source, version: nextVersion(source.version)}
        throw fixtureError('conflict', '配置文件已在别处修改，请重新读取。')
      }
      if (body.version !== source.version) throw fixtureError('conflict', '配置文件已在别处修改，请重新读取。')
      const old = source.providers?.find(item => item.name === name)
      const custom = Object.entries(body.custom_models ?? {}).map(([id, model]) => [
        id,
        {...model, rates: model.rates && {input: String(model.rates.input), cached_input: String(model.rates.cached_input), output: String(model.rates.output)}},
      ])
      const provider: ProviderStatus = {
        name, kind: body.kind ?? 'compatible', base_url: body.base_url, api_protocol: body.protocol ?? 'responses',
        has_key: body.api_key === undefined ? (old?.has_key ?? false) : Boolean(body.api_key),
        requires_key: body.requires_key,
        key_hint: body.api_key === undefined ? old?.key_hint : body.api_key ? '••••0002' : undefined,
        configured_models: body.models, models: [...(body.models ?? []), ...Object.keys(body.custom_models ?? {})],
        custom_models: Object.fromEntries(custom),
      }
      source = {
        ...source, version: nextVersion(source.version),
        providers: [...(source.providers ?? []).filter(item => item.name !== name), provider],
      }
      return source
    },
    remove: async (name, version) => {
      if (version !== source.version) throw fixtureError('conflict', '配置文件已在别处修改，请重新读取。')
      source = {...source, version: nextVersion(source.version), providers: source.providers?.filter(item => item.name !== name)}
      return source
    },
  }
  return {initial, api}
}
