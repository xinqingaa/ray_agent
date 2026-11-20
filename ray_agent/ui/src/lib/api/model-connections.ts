import type {components} from '@contracts/openapi'
import type {ConnectionSource} from './types'
import {del, get, post, put} from './fetch'

type Schemas = components['schemas']
export type ProviderProbe = Schemas['ProviderProbe']
export type ProviderSave = Schemas['ProviderSave']
export type CustomModelDraft = Schemas['CustomModel-Input']
type ProbeResult = Schemas['ProviderProbeResult']

const root = '/app-config/llm/providers'
export const MODEL_CONNECTIONS_CHANGED = 'rayagent:model-connections-changed'

export const modelConnectionsApi = {
  get: () => get<ConnectionSource>(root),
  save: (name: string, body: ProviderSave) => put<ConnectionSource>(`${root}/${encodeURIComponent(name)}`, body),
  remove: (name: string, version: string) =>
    del<ConnectionSource>(`${root}/${encodeURIComponent(name)}?version=${encodeURIComponent(version)}`),
  models: (body: ProviderProbe) => post<ProbeResult>(`${root}/models`, body),
  test: (body: ProviderProbe) => post<ProbeResult>(`${root}/test`, body),
}
