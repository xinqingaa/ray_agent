import {
  comparableCostCny, formatCostAmounts, formatCostParts, formatExactCostAmounts, type CostAmounts, type CostCurrency, type UsageRange, type UsageTotals,
} from '@/lib/api/usage'

export const ranges: [Exclude<UsageRange, 'custom'>, string][] = [
  ['today', '今天'], ['24h', '24 小时'], ['3d', '近 3 天'], ['7d', '近 7 天'], ['30d', '近 30 天'], ['90d', '近 90 天'],
]
export type Range = {range_id: Exclude<UsageRange, 'custom'>} | {range_id: 'custom'; start: string; end: string; hourly?: boolean}
export type Series = {key: string; label: string; color: string}
export type CurrencyMode = 'CNY' | 'USD' | 'mixed' | 'none'

export const weekdays = ['一', '二', '三', '四', '五', '六', '日']
export const fmt = (n: number) => n.toLocaleString('zh-CN')
export const tokenLabel = (n: number) => n >= 1e9 ? (n / 1e9).toFixed(2) + 'B'
  : n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : fmt(n)
export const pad = (n: number) => String(n).padStart(2, '0')
export const dayOf = (iso: string) => iso.slice(0, 10)
export const timeOf = (iso: string) => iso.slice(11, 16)
export const wallDate = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
export const localDate = (value: string, hour = 0) => {
  const date = new Date(value + 'T00:00:00')
  date.setHours(hour)
  return date
}
export const dayLabel = (iso: string) => `${Number(iso.slice(5, 7))}月${Number(iso.slice(8, 10))}日`
export const shortDay = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`
export const dayWeek = (iso: string) => (localDate(dayOf(iso)).getDay() + 6) % 7
export const hitRate = (total: UsageTotals) => total.input_tokens ? Math.round(100 * total.cached_tokens / total.input_tokens) : null

export const costAmounts = (total: UsageTotals | null | undefined): CostAmounts | null =>
  total ? {usd: total.cost_nano_usd ?? null, cny: total.cost_nano_cny ?? null} : null

export const amount = (total: UsageTotals | null | undefined) => total?.cost_nano_usd ?? (total?.requests === 0 ? 0 : null)

export const comparableAmount = (total: UsageTotals | null | undefined): number | null => {
  if (!total) return null
  if (total.requests === 0) return 0
  return comparableCostCny(costAmounts(total))
}

export const cost = (total: UsageTotals | null | undefined, zeroCurrency?: CostCurrency | null) => {
  if (!total) return '—'
  if (total.requests === 0) return formatCostAmounts(null, zeroCurrency ?? 'USD')
  return formatCostAmounts(costAmounts(total))
}

export const exactCost = (total: UsageTotals | null | undefined, zeroCurrency?: CostCurrency | null) => {
  if (!total) return '—'
  if (total.requests === 0) return formatExactCostAmounts(null, zeroCurrency ?? 'USD')
  return formatExactCostAmounts(costAmounts(total))
}

export const costParts = (total: UsageTotals | null | undefined, zeroCurrency?: CostCurrency | null) => {
  if (!total) return ['—']
  if (total.requests === 0) return formatCostParts(null, zeroCurrency ?? 'USD')
  return formatCostParts(costAmounts(total))
}

export function currencyMode(total: UsageTotals | null | undefined): CurrencyMode {
  if (!total) return 'none'
  const cny = total.cost_nano_cny
  const usd = total.cost_nano_usd
  if (cny != null && usd != null) {
    if (cny > 0 && usd > 0) return 'mixed'
    if (cny > 0) return 'CNY'
    if (usd > 0) return 'USD'
    return 'CNY'
  }
  if (cny != null) return 'CNY'
  if (usd != null) return 'USD'
  return 'none'
}

export function chartValue(total: UsageTotals | null | undefined, mode: CurrencyMode): number {
  if (!total) return 0
  if (mode === 'USD') return total.cost_nano_usd ?? 0
  if (mode === 'CNY') return total.cost_nano_cny ?? 0
  return comparableCostCny(costAmounts(total)) ?? 0
}

export const priceLabels: Record<string, string> = {
  peak: '高峰', off_peak: '低谷', standard: '标准', long_context: '超长上下文', custom: '自定义',
}

export function providerSeries(key: string, label?: string): Series {
  const names: Record<string, string> = {deepseek: 'DeepSeek', openai: 'OpenAI', gpt: 'OpenAI', local: '本机'}
  const hash = [...key].reduce((sum, char) => (31 * sum + char.charCodeAt(0)) >>> 0, 0)
  const index = key === 'deepseek' ? 1 : key === 'openai' || key === 'gpt' ? 2 : 3 + hash % 3
  return {key, label: label ?? names[key] ?? key, color: `var(--chart-${index})`}
}

export function selectedRange(from: string, to: string, startHour = 0, endHour = 24, hourly = false): Range {
  return {range_id: 'custom', start: localDate(from, startHour).toISOString(), end: localDate(to, endHour).toISOString(), hourly}
}

export function customParts(range: Extract<Range, {range_id: 'custom'}>) {
  const start = new Date(range.start)
  const end = new Date(range.end)
  const last = new Date(+end - 1)
  return {from: wallDate(start), to: wallDate(last), startHour: start.getHours(), endHour: end.getHours() || 24}
}

export function rangeLabel(range: Range, short = false) {
  if (range.range_id !== 'custom') return ranges.find(([key]) => key === range.range_id)?.[1] ?? ''
  const {from, to, startHour, endHour} = customParts(range)
  const label = short ? shortDay : dayLabel
  if (!range.hourly) return from === to ? label(from) : `${label(from)} – ${label(to)}`
  return `${label(from)} ${pad(startHour)}:00–${from === to ? '' : label(to) + ' '}${pad(endHour)}:00`
}
