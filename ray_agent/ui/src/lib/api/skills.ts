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
}
export type Skill = SkillSelection & {
  name: string
  description: string
  enabled: boolean
  included?: boolean
  catalog_overflow?: boolean
  builtin: boolean
  external?: boolean
  status?: string
  conflict?: boolean
  auto_bound?: boolean
  root_path?: string | null
  source: SkillSourceInfo
}
export type SkillDetail = Skill & {text: string; files: {path: string; size: number; sha256: string}[]; warnings: string[]}
export type SkillCandidate = {path: string; name: string; description: string; version: string; text: string; files: SkillDetail['files']; warnings: string[]}
export type SkillImport = {id: string; stage: string; source: Skill['source']; candidates: SkillCandidate[]; error: string | null; notice?: string | null; result: Skill | null}
export type SkillConfig = {
  discover_user: boolean
  discover_workspace: boolean
  disabled_sources: string[]
  disabled_skills: string[]
  extra_dirs: string[]
  preferred: Record<string, string>
}
export type SkillSourcesPayload = {
  config: SkillConfig
  sources: {source_id: string; kind: string; label: string; path: string | null; enabled: boolean; exists: boolean; workspace_id?: string | null}[]
}
export const SKILLS_CHANGED = 'rayagent-skills-changed'
export function skillsChanged() {window.dispatchEvent(new Event(SKILLS_CHANGED))}
export const skillsApi = {
  file: (skill: Skill, path: string) => requestBlob(`/skills/${encodeURIComponent(skill.id)}/file?${new URLSearchParams({expected_version: skill.version, path})}`),
  importFile: (id: string, candidate: SkillCandidate, path: string) => requestBlob(`/skills/imports/${id}/file?${new URLSearchParams({candidate_path: candidate.path, fingerprint: candidate.version, path})}`),
  revise: (id: string, candidate: SkillCandidate, text: string, revision_id: string) => request<SkillImport>(`/skills/imports/${id}/content`, {method: 'PUT', body: JSON.stringify({candidate_path: candidate.path, fingerprint: candidate.version, text, revision_id})}),
  list: (workspaceId?: string) => request<Skill[]>(`/skills${workspaceId ? `?workspace_id=${encodeURIComponent(workspaceId)}` : ''}`),
  sources: (workspaceId?: string) => request<SkillSourcesPayload>(`/skills/sources${workspaceId ? `?workspace_id=${encodeURIComponent(workspaceId)}` : ''}`),
  scan: (workspaceId?: string) => request<Skill[]>(`/skills/scan${workspaceId ? `?workspace_id=${encodeURIComponent(workspaceId)}` : ''}`, {method: 'POST'}),
  config: () => request<SkillConfig>('/skills/config'),
  updateConfig: (payload: SkillConfig) => request<SkillConfig>('/skills/config', {method: 'PUT', body: JSON.stringify(payload)}),
  addExtraDir: (grantId: string) => request<SkillConfig>('/skills/extra-dirs', {method: 'POST', body: JSON.stringify({grant_id: grantId})}),
  removeExtraDir: (path: string) => request<SkillConfig>(`/skills/extra-dirs?path=${encodeURIComponent(path)}`, {method: 'DELETE'}),
  prefer: (name: string, skillId: string | null) => request<SkillConfig>('/skills/prefer', {method: 'POST', body: JSON.stringify({name, skill_id: skillId})}),
  detail: (id: string) => request<SkillDetail>(`/skills/${encodeURIComponent(id)}`),
  import: (payload: {operation_id: string; kind: 'github' | 'manual'; url?: string; text?: string; update_name?: string; expected_version?: string}) => request<SkillImport>('/skills/imports', {method: 'POST', body: JSON.stringify(payload), timeout: 120000}),
  uploadLocal: (data: FormData) => request<SkillImport>('/skills/imports/local', {method: 'POST', body: data, timeout: 120000}),
  operation: (id: string) => request<SkillImport>(`/skills/imports/${id}`),
  publish: (id: string, candidate: SkillCandidate) => request<SkillImport>(`/skills/imports/${id}/publish`, {method: 'POST', body: JSON.stringify({candidate_path: candidate.path, fingerprint: candidate.version})}),
  edit: (skill: Skill, text: string) => request<SkillImport>(`/skills/${encodeURIComponent(skill.id)}`, {method: 'PUT', body: JSON.stringify({expected_version: skill.version, text})}),
  toggle: (skill: Skill) => request<Skill>(`/skills/${encodeURIComponent(skill.id)}`, {method: 'PATCH', body: JSON.stringify({expected_version: skill.version, enabled: !skill.enabled})}),
  setIncluded: (skill: Skill, included: boolean) => request<Skill>(`/skills/${encodeURIComponent(skill.id)}`, {method: 'PATCH', body: JSON.stringify({expected_version: skill.version, included})}),
  delete: (skill: Skill) => request(`/skills/${encodeURIComponent(skill.id)}?expected_version=${skill.version}`, {method: 'DELETE'}),
}
