import type {components} from '@contracts/openapi'
import type {ConnectionSource, ProviderStatus} from './types'
import {del, get, post, put} from './fetch'

type Schemas = components['schemas']
export type ProviderProbe = Schemas['ProviderProbe']
export type ProviderSave = Schemas['ProviderSave']
export type CustomModelDraft = Schemas['CustomModel-Input']
type ProbeResult = Schemas['ProviderProbeResult']
export type ProbedModel = Schemas['ProbedModel']
export type CatalogModel = Schemas['CatalogModelItem']
export type CatalogResponse = Schemas['CatalogResponse']
export type ToolCheckResult = Schemas['ToolCheckResult']

const root = '/app-config/llm/providers'
export const MODEL_CONNECTIONS_CHANGED = 'rayagent:model-connections-changed'

/**
 * 官方 DeepSeek 连接：HTTPS、api.deepseek.com 且已配置密钥。与后端语音转写选用的端点规则一致。
 */
export function isOfficialDeepSeek(provider: ProviderStatus): boolean {
  try {
    const url = new URL(provider.base_url ?? '')
    return url.protocol === 'https:' && url.host === 'api.deepseek.com' && Boolean(provider.key_hint)
  } catch {
    return false
  }
}

export const modelConnectionsApi = {
  get: () => get<ConnectionSource>(root),
  save: (name: string, body: ProviderSave) => put<ConnectionSource>(`${root}/${encodeURIComponent(name)}`, body),
  remove: (name: string, version: string) =>
    del<ConnectionSource>(`${root}/${encodeURIComponent(name)}?version=${encodeURIComponent(version)}`),
  catalog: () => get<CatalogResponse>('/app-config/llm/catalog'),
  models: (body: ProviderProbe) => post<ProbeResult>(`${root}/models`, body),
  test: (body: ProviderProbe) => post<ProbeResult>(`${root}/test`, body),
  toolCheck: (body: ProviderProbe) => post<ToolCheckResult>(`${root}/tool-check`, body),
}
