import {request} from './fetch'
export type SkillSelection = {id: string; version: string}
export type Skill = SkillSelection & {name: string; description: string; enabled: boolean; builtin: boolean; source: {kind: string; url?: string; commit?: string}}
export type SkillDetail = Skill & {text: string; files: {path: string; size: number; sha256: string}[]; warnings: string[]}
export type SkillCandidate = {path: string; name: string; description: string; version: string; text: string; files: SkillDetail['files']; warnings: string[]}
export type SkillImport = {id: string; stage: string; source: Skill['source']; candidates: SkillCandidate[]; error: string | null; result: Skill | null}
export const SKILLS_CHANGED = 'rayagent-skills-changed'
export function skillsChanged() {window.dispatchEvent(new Event(SKILLS_CHANGED))}
export const skillsApi = {
  list: () => request<Skill[]>('/skills'),
  detail: (name: string) => request<SkillDetail>(`/skills/${encodeURIComponent(name)}`),
  import: (payload: {operation_id: string; kind: 'github' | 'manual'; url?: string; text?: string; update_name?: string; expected_version?: string}) => request<SkillImport>('/skills/imports', {method: 'POST', body: JSON.stringify(payload), timeout: 120000}),
  upload: (data: FormData) => request<SkillImport>('/skills/imports/zip', {method: 'POST', body: data, timeout: 120000}),
  operation: (id: string) => request<SkillImport>(`/skills/imports/${id}`),
  publish: (id: string, candidate: SkillCandidate) => request<SkillImport>(`/skills/imports/${id}/publish`, {method: 'POST', body: JSON.stringify({candidate_path: candidate.path, fingerprint: candidate.version})}),
  edit: (skill: Skill, text: string) => request<SkillImport>(`/skills/${skill.name}`, {method: 'PUT', body: JSON.stringify({expected_version: skill.version, text})}),
  toggle: (skill: Skill) => request<Skill>(`/skills/${skill.name}`, {method: 'PATCH', body: JSON.stringify({expected_version: skill.version, enabled: !skill.enabled})}),
  delete: (skill: Skill) => request(`/skills/${skill.name}?expected_version=${skill.version}`, {method: 'DELETE'}),
}
