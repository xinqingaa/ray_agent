import type {components, paths} from '@contracts/openapi'
import {get, patch, request} from './fetch'

type Schemas = components['schemas']
export type UsagePreferences = Schemas['UsagePreferences']
export type UsageReport = Schemas['UsageReport']
export type UsageTotals = Schemas['UsageTotals']
export type UsageGroup = Schemas['UsageGroup']
export type UsageBucket = Schemas['UsageBucket']
export type UsageHour = Schemas['UsageHour']
type UsageQuery = NonNullable<paths['/api/usage']['get']['parameters']['query']>
export type UsageRange = NonNullable<UsageQuery['range_id']>
type VoiceQuery = NonNullable<paths['/api/voice/transcriptions']['post']['parameters']['query']>
export type VoiceEngine = NonNullable<VoiceQuery['engine']>

export type CostCurrency = 'USD' | 'CNY'
export type CostAmounts = {usd?: number | null; cny?: number | null}
export const REFERENCE_USD_TO_CNY = 7

export const USAGE_RECORDED = 'rayagent:usage-recorded'

export const usageApi = {
  preferences: () => get<UsagePreferences>('/usage/preferences'),
  setPreferences: (fields: Partial<UsagePreferences>) => patch<UsagePreferences>('/usage/preferences', fields),
  providers: () => get<string[]>('/usage/providers'),
  report: (params: UsageQuery) => get<UsageReport>('/usage', {
    ...(params.range_id && {range_id: params.range_id}),
    ...(params.start && {start: params.start}),
    ...(params.end && {end: params.end}),
    ...(params.provider && {provider: params.provider}),
  }),
  session: (id: string) => get<UsageTotals>(`/usage/sessions/${encodeURIComponent(id)}`),
  transcribe: (audio: Blob, engine: VoiceEngine, sessionId: string | null | undefined, signal: AbortSignal) => {
    const query = new URLSearchParams({engine})
    if (sessionId) query.set('session_id', sessionId)
    return request<Schemas['ASRResult']>(`/voice/transcriptions?${query}`, {
      method: 'POST', body: audio, headers: {'Content-Type': 'audio/wav'}, timeout: 145000, signal,
    })
  },
}

export const SUB_CENT_NANOS = 10_000_000

export function formatExactCost(nanos: number | null | undefined, currency: CostCurrency = 'USD') {
  if (nanos == null) return '—'
  const symbol = currency === 'CNY' ? '¥' : '$'
  if (nanos > 0 && nanos < 1000) return `<${symbol}0.000001`
  return symbol + (nanos / 1e9).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 6})
}

export function formatEstimatedCost(nanos: number | null | undefined, currency: CostCurrency = 'USD') {
  if (nanos == null) return '—'
  const symbol = currency === 'CNY' ? '¥' : '$'
  if (nanos > 0 && nanos < SUB_CENT_NANOS) return `<${symbol}0.01`
  return symbol + (nanos / 1e9).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})
}

export function hasAnyCost(amounts: CostAmounts | null | undefined): boolean {
  return amounts?.usd != null || amounts?.cny != null
}

export function formatCostParts(
  amounts: CostAmounts | null | undefined,
  zeroCurrency?: CostCurrency | null,
  options?: {exact?: boolean},
): string[] {
  const fmt = options?.exact ? formatExactCost : formatEstimatedCost
  const usd = amounts?.usd
  const cny = amounts?.cny
  if (cny == null && usd == null) {
    return [zeroCurrency ? fmt(0, zeroCurrency) : '—']
  }
  if (cny != null && usd == null) return [fmt(cny, 'CNY')]
  if (usd != null && cny == null) return [fmt(usd, 'USD')]
  if ((cny ?? 0) > 0 && (usd ?? 0) > 0) {
    return [fmt(cny, 'CNY'), fmt(usd, 'USD')]
  }
  if ((cny ?? 0) > 0) return [fmt(cny, 'CNY')]
  if ((usd ?? 0) > 0) return [fmt(usd, 'USD')]
  return [fmt(0, zeroCurrency ?? 'USD')]
}

export function formatCostAmounts(
  amounts: CostAmounts | null | undefined,
  zeroCurrency?: CostCurrency | null,
): string {
  return formatCostParts(amounts, zeroCurrency).join(' + ')
}

export function formatExactCostAmounts(
  amounts: CostAmounts | null | undefined,
  zeroCurrency?: CostCurrency | null,
): string {
  return formatCostParts(amounts, zeroCurrency, {exact: true}).join(' + ')
}

export function comparableCostCny(amounts: CostAmounts | null | undefined): number | null {
  if (!hasAnyCost(amounts)) return null
  return (amounts?.cny ?? 0) + (amounts?.usd ?? 0) * REFERENCE_USD_TO_CNY
}
