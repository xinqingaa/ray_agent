import type {ModelCatalog} from '@/lib/api/types'
export type CatalogModel = ModelCatalog['models'][number]
export type ModelSelection = {model: string; reasoning: string}
export type VendorId = string

export const thinkingOptions = (model: CatalogModel) => model.reasoning_options.filter(option => option.enabled)

const REASONING_LABELS: Record<string, string> = {
  none: '关闭', disabled: '关闭', minimal: '极低', low: '低', medium: '中', high: '高', xhigh: '很高', max: '最高',
}

/** 思考档位的界面短名；目录里没有对应译名的档位保留原词。 */
export const reasoningLabel = (id: string) => REASONING_LABELS[id] ?? id

/** 上下文窗口的紧凑写法，如 1M、200K。 */
export function contextLabel(tokens: number): string {
  if (tokens >= 1_000_000) return `${+(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`
  return String(tokens)
}

/** 能力来源未确认时的字段名；与核心 CustomModel.unconfirmed 的取值一致。 */
export const unconfirmedLabels = {
  context_window: '窗口', max_output: '输出', tools: '工具调用', vision: '图片输入', thinking: '思考',
} as const
export type UnconfirmedKey = keyof typeof unconfirmedLabels
export const unconfirmedKeys = Object.keys(unconfirmedLabels) as UnconfirmedKey[]
export const isUnconfirmedKey = (value: string): value is UnconfirmedKey => value in unconfirmedLabels

/** 能力未确认只做提示，不阻塞选择：返回需要提示的字段名，没有则为空。 */
export function unconfirmedFields(model: Pick<CatalogModel, 'unconfirmed'>): string[] {
  return (model.unconfirmed ?? []).map(key => unconfirmedLabels[key as UnconfirmedKey] ?? key)
}

/** 模型行的第二行：只写目录声明的容量，不写目录之外的评价。 */
export function modelFacts(model: CatalogModel): string {
  return `上下文 ${contextLabel(model.context_window)} · 输出上限 ${contextLabel(model.max_output)}${model.tools === false ? ' · 不支持工具调用' : ''}`
}

export function selectModel(previous: ModelSelection, source: CatalogModel | undefined, target: CatalogModel): ModelSelection {
  const compatible = source?.reasoning_family != null && source.reasoning_family === target.reasoning_family && target.choices.includes(previous.reasoning)
  return {model: target.id, reasoning: compatible ? previous.reasoning : target.default_choice}
}

export function vendorOf(modelId: string, models: CatalogModel[]): VendorId | null {
  return models.find(model => model.id === modelId)?.vendor ?? null
}

export function vendorTabs(models: CatalogModel[]): {id: VendorId; label: string}[] {
  const vendors = new Map<string, string>()
  for (const model of models) vendors.set(model.vendor, model.vendor_label)
  return [...vendors].map(([id, label]) => ({id, label}))
}

export function modelsForVendor(models: CatalogModel[], vendor: VendorId): CatalogModel[] {
  return models.filter(model => model.vendor === vendor)
}
