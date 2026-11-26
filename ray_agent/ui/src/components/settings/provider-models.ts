import type {CatalogModel, CustomModelDraft, ProbedModel} from '@/lib/api/model-connections'
import {isUnconfirmedKey, unconfirmedKeys, type UnconfirmedKey} from '@/lib/model-selection'

export const capabilities = {tools: '工具调用', vision: '图片输入', thinking: '思考'} as const
export const rateLabels = {input: '输入单价', cached_input: '缓存命中', outputRate: '输出单价'} as const
export const capKeys = Object.keys(capabilities) as (keyof typeof capabilities)[]
export const rateKeys = Object.keys(rateLabels) as (keyof typeof rateLabels)[]

/** 思考档位上限与格式与核心 CustomModel 一致；数值的权威来源是运行参数文档。 */
export const EFFORT_LIMIT = 8
const EFFORT_PATTERN = /^[A-Za-z0-9_.-]{1,32}$/
const RESERVED_EFFORTS = ['enabled', 'disabled']

/** 一个模型的可编辑内容：界面字符串形式，保存前由 validateCustom 转换。 */
export type ModelDraft = {
  window: string
  output: string
  tools: boolean
  vision: boolean
  thinking: boolean
  efforts: string[]
  unconfirmed: UnconfirmedKey[]
  rateCurrency: 'USD' | 'CNY'
  input: string
  cached_input: string
  outputRate: string
}

/** 核心返回的已保存或上游模型事实，形状与 CustomModel 输出一致。 */
export type ModelFacts = {
  context_window: number
  max_output: number
  tools?: boolean
  vision?: boolean
  thinking?: boolean
  reasoning_efforts?: string[]
  unconfirmed?: string[]
  rates?: {currency?: 'USD' | 'CNY'; input: string; cached_input: string; output: string} | null
}

function modelSize(value: string) {
  const parts = /^(\d+(?:\.\d+)?)([km]?)$/i.exec(value.trim())
  if (!parts) return NaN
  return Number(parts[1]) * ({k: 1024, m: 1_000_000}[parts[2].toLowerCase()] ?? 1)
}

function sizeLabel(value: number) {
  if (value >= 1_000_000 && value % 1_000_000 === 0) return value / 1_000_000 + 'M'
  if (value >= 1024 && value % 1024 === 0) return value / 1024 + 'K'
  return String(value)
}

function rateText(value: string | number | undefined) {
  if (value == null) return ''
  const text = String(value)
  return /[eE]|\.\d{9}/.test(text) ? Number(value).toFixed(8).replace(/\.?0+$/, '') : text
}

const unconfirmedOf = (values: string[] | undefined): UnconfirmedKey[] =>
  unconfirmedKeys.filter(key => values?.includes(key) && isUnconfirmedKey(key))

export function draftFromFacts(facts: ModelFacts): ModelDraft {
  return {
    window: sizeLabel(facts.context_window),
    output: sizeLabel(facts.max_output),
    tools: facts.tools ?? false,
    vision: facts.vision ?? false,
    thinking: facts.thinking ?? false,
    efforts: [...(facts.reasoning_efforts ?? [])],
    unconfirmed: unconfirmedOf(facts.unconfirmed),
    rateCurrency: facts.rates?.currency === 'CNY' ? 'CNY' : 'USD',
    input: rateText(facts.rates?.input),
    cached_input: rateText(facts.rates?.cached_input),
    outputRate: rateText(facts.rates?.output),
  }
}

/** 上游读取结果：来源为 unconfirmed 的字段进入「能力未确认」，其余按上游值填入。 */
export function draftFromProbe(probe: ProbedModel): ModelDraft {
  return draftFromFacts({
    context_window: probe.context_window,
    max_output: probe.max_output,
    tools: probe.tools,
    vision: probe.vision,
    thinking: probe.thinking,
    reasoning_efforts: probe.reasoning_efforts,
    rates: probe.rates,
    unconfirmed: Object.entries(probe.sources).filter(([, source]) => source === 'unconfirmed').map(([key]) => key),
  })
}

/** 目录模型只用于展示，能力与单价来自内置目录，界面不修改。 */
export function draftFromCatalog(model: CatalogModel): ModelDraft {
  const efforts = (model.reasoning_options ?? []).filter(option => option.enabled === true).map(option => String(option.id))
  return draftFromFacts({
    context_window: model.context_window,
    max_output: model.max_output,
    tools: model.tools,
    vision: model.vision,
    thinking: efforts.length > 0,
    reasoning_efforts: efforts,
    rates: model.has_builtin_pricing ? model.rates : null,
  })
}

/** 目录外模型的保守默认：与核心 custom_declaration 一致，全部标为未确认。 */
export function declarationDraft(): ModelDraft {
  return draftFromFacts({context_window: 32_000, max_output: 4_096, tools: true, vision: false, thinking: false, unconfirmed: unconfirmedKeys})
}

const touchedBy: Record<string, UnconfirmedKey> = {window: 'context_window', output: 'max_output', tools: 'tools', vision: 'vision', thinking: 'thinking', efforts: 'thinking'}

/** 用户编辑后的草稿：被修改的能力视为已确认，移出「能力未确认」。 */
export function editedDraft(draft: ModelDraft, patch: Partial<ModelDraft>): ModelDraft {
  const next: ModelDraft = {...draft, ...patch}
  if (patch.efforts) next.thinking = draft.thinking || patch.efforts.length > 0
  const confirmed = new Set(Object.keys(patch).map(key => touchedBy[key]).filter(Boolean))
  next.unconfirmed = draft.unconfirmed.filter(key => !confirmed.has(key))
  return next
}

export function effortError(efforts: string[]): string | null {
  if (efforts.length > EFFORT_LIMIT) return `思考档位最多 ${EFFORT_LIMIT} 个。`
  const seen = new Set<string>()
  for (const effort of efforts) {
    if (RESERVED_EFFORTS.includes(effort)) return `思考档位不能使用 ${effort}，开关已表示关闭。`
    if (!EFFORT_PATTERN.test(effort)) return `思考档位「${effort}」须为 1 至 32 个字母、数字、点、下划线或连字符。`
    if (seen.has(effort)) return `思考档位「${effort}」重复。`
    seen.add(effort)
  }
  return null
}

export function modelIdError(id: string) {
  return !id || [...id].length > 128 || /\p{White_Space}/u.test(id)
    ? '填写 1 至 128 个字符的模型 ID，不能含空白。' : null
}

/** 保存前的本地校验；核心仍会再次校验并以模型 ID 返回错误。 */
export function validateCustom(id: string, draft: ModelDraft): {value: CustomModelDraft; error?: never} | {error: string; value?: never} {
  const idError = modelIdError(id)
  if (idError) return {error: idError}
  const context_window = modelSize(draft.window)
  const max_output = modelSize(draft.output)
  if (!Number.isInteger(context_window) || context_window > 10_000_000 || context_window < 2 ||
    !Number.isInteger(max_output) || !(max_output > 0 && max_output < context_window * .95)) {
    return {error: '请填写有效的窗口与输出上限，输出须为输入留出空间。'}
  }
  const efforts = effortError(draft.efforts)
  if (efforts) return {error: efforts}
  const [input, cached, output] = rateKeys.map(key => draft[key].trim())
  const prices = [input, cached, output]
  const priced = prices.some(Boolean)
  if (priced && (!input || !output || prices.some(price => price && (!/^\d*(?:\.\d{1,8})?$/.test(price) || Number(price) > 1_000_000)))) {
    return {error: '请同时填写有效的输入和输出单价，最多 8 位小数。缓存单价可留空。'}
  }
  return {value: {
    context_window, max_output, tools: draft.tools, vision: draft.vision,
    thinking: draft.thinking || draft.efforts.length > 0,
    reasoning_efforts: draft.efforts, unconfirmed: draft.unconfirmed,
    rates: priced ? {currency: draft.rateCurrency, input, cached_input: cached || input, output} : null,
  }}
}

/** 按模型单价币种展示每百万 Token 价格；没有依据时明确写出未计价。 */
export function priceText(draft: ModelDraft, catalog: boolean) {
  const symbol = draft.rateCurrency === 'CNY' ? '¥' : '$'
  if (draft.input.trim() && draft.outputRate.trim()) return `${symbol}${draft.input.trim()} / ${symbol}${draft.outputRate.trim()}`
  return catalog ? '未计价' : '未填写单价'
}

/** 模型行第二行：窗口、输出与已开启的能力；关闭的能力不占位。 */
export function factsLine(draft: ModelDraft, reasoningName: (id: string) => string) {
  const flags = [draft.tools && '工具调用', draft.vision && '图片输入',
    draft.thinking && (draft.efforts.length ? `思考 ${draft.efforts.map(reasoningName).join('、')}` : '思考')].filter(Boolean)
  return [`窗口 ${draft.window}`, `输出 ${draft.output}`, ...(flags.length ? flags : ['未开启工具、图片或思考'])].join(' · ')
}
