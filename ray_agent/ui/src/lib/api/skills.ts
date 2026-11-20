import {request, requestBlob} from './fetch'
export type SkillSelection = {id: string; version: string}
export type SkillSourceInfo = {
  kind: string
  label?: string
  url?: string
  commit?: string
  path?: string
  canonical?: string
  source_id?: string
  group?: string
}
export type Skill = SkillSelection & {
  name: string
  description: string
  enabled: boolean
  configured_enabled?: boolean
  source_state?: string
  market?: {id: string; commit: string}
  included?: boolean
  catalog_overflow?: boolean
  builtin: boolean
  external?: boolean
  status?: string
  conflict?: boolean
  same_name?: boolean
  preferred?: boolean
  auto_bound?: boolean
  root_path?: string | null
  source: SkillSourceInfo
  locations?: {source: SkillSourceInfo; status: string}[]
}
export type SkillDetail = Skill & {text: string; files: {path: string; size: number; sha256: string}[]; warnings: string[]}
export type SkillCandidate = {path: string; name: string; description: string; version: string; text: string; files: SkillDetail['files']; warnings: string[]}
export type SkillImport = {id: string; stage: string; source: Skill['source']; candidates: SkillCandidate[]; error: string | null; notice?: string | null; result: Skill | null}
export type SkillConfig = {
  discover_user: boolean
  discover_workspace: boolean
  disabled_sources: string[]
  disabled_groups: string[]
  disabled_skills: string[]
  extra_dirs: string[]
  preferred: Record<string, string>
  workspace_preferred: Record<string, Record<string, string>>
}
export type SkillSourcesPayload = {
  config: SkillConfig
  groups: {id: string; label: string; enabled: boolean; count: number}[]
  sources: {source_id: string; kind: string; label: string; path: string; group: string; enabled: boolean; instance_enabled: boolean; exists: boolean; count: number; problems: {path: string; error: string}[]}[]
}
export type SkillMarketItem = {id: string; repository: string; slug: string; name: string; installs: number; count_label: string | null; description?: string | null}
export type SkillMarketTarget = {workspace_id: string | null; target_id: string; directory: string}
export type SkillMarketPage = {items: SkillMarketItem[]; has_more: boolean; updated_at: number; stale: boolean}
const scoped = (workspaceId?: string) => workspaceId ? `?workspace_id=${encodeURIComponent(workspaceId)}` : ''
const scopeParam = (workspaceId?: string): Record<string, string> => workspaceId ? {workspace_id: workspaceId} : {}
export const SKILLS_CHANGED = 'rayagent-skills-changed'
export function skillsChanged() {window.dispatchEvent(new Event(SKILLS_CHANGED))}
export const skillsApi = {
  file: (skill: Skill, path: string, workspaceId?: string, runId?: string) => requestBlob(`/skills/${encodeURIComponent(skill.id)}/file?${new URLSearchParams({expected_version: skill.version, path, ...scopeParam(workspaceId), ...(runId ? {run_id: runId} : {})})}`),
  importFile: (id: string, candidate: SkillCandidate, path: string) => requestBlob(`/skills/imports/${id}/file?${new URLSearchParams({candidate_path: candidate.path, fingerprint: candidate.version, path})}`),
  revise: (id: string, candidate: SkillCandidate, text: string, revision_id: string) => request<SkillImport>(`/skills/imports/${id}/content`, {method: 'PUT', body: JSON.stringify({candidate_path: candidate.path, fingerprint: candidate.version, text, revision_id})}),
  list: (workspaceId?: string, refresh = true) => request<Skill[]>(`/skills?${new URLSearchParams({...scopeParam(workspaceId), refresh: String(refresh)})}`),
  market: (q: string, offset: number) => request<SkillMarketPage>(`/skills/market?${new URLSearchParams({q, offset: String(offset)})}`),
  marketDescriptions: (ids: string[]) => request<Record<string, string | null>>('/skills/market/descriptions',
    {method: 'POST', body: JSON.stringify({ids}), timeout: 45000}),
  marketTargets: (workspaceId?: string) => request<SkillMarketTarget[]>(`/skills/market/targets${scoped(workspaceId)}`),
  marketInstall: (id: string, item: SkillMarketItem, target: SkillMarketTarget) => request<SkillImport & {destination?: string}>('/skills/market/install', {method: 'POST', body: JSON.stringify({operation_id: id, repository: item.repository, slug: item.slug, workspace_id: target.workspace_id, target_id: target.target_id}), timeout: 150000}),
  sources: (workspaceId?: string) => request<SkillSourcesPayload>(`/skills/sources${workspaceId ? `?workspace_id=${encodeURIComponent(workspaceId)}` : ''}`),
  scan: (workspaceId?: string) => request<Skill[]>(`/skills/scan${workspaceId ? `?workspace_id=${encodeURIComponent(workspaceId)}` : ''}`, {method: 'POST'}),
  config: () => request<SkillConfig>('/skills/config'),
  updateConfig: (payload: SkillConfig) => request<SkillConfig>('/skills/config', {method: 'PUT', body: JSON.stringify(payload)}),
  addExtraDir: (grantId: string) => request<SkillConfig>('/skills/extra-dirs', {method: 'POST', body: JSON.stringify({grant_id: grantId})}),
  removeExtraDir: (path: string) => request<SkillConfig>(`/skills/extra-dirs?path=${encodeURIComponent(path)}`, {method: 'DELETE'}),
  prefer: (name: string, skillId: string | null, workspaceId?: string) => request<SkillConfig>('/skills/prefer', {method: 'POST', body: JSON.stringify({name, skill_id: skillId, workspace_id: workspaceId})}),
  detail: (id: string, workspaceId?: string, expectedVersion?: string, runId?: string) => request<SkillDetail>(`/skills/${encodeURIComponent(id)}?${new URLSearchParams({...scopeParam(workspaceId), ...(expectedVersion ? {expected_version: expectedVersion} : {}), ...(runId ? {run_id: runId} : {})})}`),
  import: (payload: {operation_id: string; kind: 'github' | 'manual'; url?: string; text?: string; update_name?: string; expected_version?: string}) => request<SkillImport>('/skills/imports', {method: 'POST', body: JSON.stringify(payload), timeout: 120000}),
  uploadLocal: (data: FormData) => request<SkillImport>('/skills/imports/local', {method: 'POST', body: data, timeout: 120000}),
  operation: (id: string) => request<SkillImport>(`/skills/imports/${id}`),
  publish: (id: string, candidate: SkillCandidate) => request<SkillImport>(`/skills/imports/${id}/publish`, {method: 'POST', body: JSON.stringify({candidate_path: candidate.path, fingerprint: candidate.version})}),
  edit: (skill: Skill, text: string) => request<SkillImport>(`/skills/${encodeURIComponent(skill.id)}`, {method: 'PUT', body: JSON.stringify({expected_version: skill.version, text})}),
  setMode: (skill: Skill, mode: 'off' | 'selectable' | 'included', workspaceId?: string) => request<Skill>(
    `/skills/${encodeURIComponent(skill.id)}${scoped(workspaceId)}`,
    {method: 'PATCH', body: JSON.stringify({expected_version: skill.version, enabled: mode !== 'off', included: mode === 'included'})},
  ),
  delete: (skill: Skill, workspaceId?: string) => request(`/skills/${encodeURIComponent(skill.id)}?${new URLSearchParams({expected_version: skill.version, ...scopeParam(workspaceId)})}`, {method: 'DELETE'}),
}
