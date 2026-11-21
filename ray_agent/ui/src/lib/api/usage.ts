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

export function formatEstimatedCost(nanos: number | null | undefined) {
  if (nanos == null) return '—'
  if (nanos > 0 && nanos < 1000) return '<$0.000001'
  return '$' + (nanos / 1e9).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 6})
}
