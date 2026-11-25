import type {AgentOutputPolicy, DocumentCategory, IndexPolicy, IndexSummary} from '@/lib/api/documents'

export const DOCUMENT_CATEGORIES: readonly {id: DocumentCategory; label: string}[] = [
  {id: 'documents', label: '文档与演示'},
  {id: 'spreadsheets', label: '表格与数据'},
  {id: 'images', label: '图片文字'},
  {id: 'code', label: '代码与脚本'},
]

export const DEFAULT_ENABLED_CATEGORIES: readonly DocumentCategory[] = ['documents', 'spreadsheets', 'images']

export const AGENT_OUTPUT_OPTIONS: readonly {value: AgentOutputPolicy; label: string}[] = [
  {value: 'manual', label: '手动纳入'},
  {value: 'auto', label: '自动纳入'},
]

const DOCUMENTS_EXT = new Set(['.txt', '.md', '.mdx', '.markdown', '.rst', '.pdf', '.doc', '.docx', '.pptx'])
const SPREADSHEETS_EXT = new Set(['.xlsx', '.csv', '.tsv'])
const IMAGES_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tif', '.tiff'])
const CODE_EXT = new Set([
  '.py', '.js', '.jsx', '.ts', '.tsx', '.css', '.scss', '.less', '.sh', '.bash', '.zsh',
  '.yaml', '.yml', '.toml', '.xml', '.sql', '.go', '.rs', '.java', '.kt', '.c', '.h', '.cpp',
  '.hpp', '.cs', '.rb', '.php', '.swift', '.r', '.lua', '.pl', '.diff', '.patch',
  '.log', '.ini', '.cfg', '.conf', '.json', '.jsonl', '.jsonc', '.html', '.htm',
])

export function categoryForPath(relativePath: string): DocumentCategory | null {
  const lowered = relativePath.toLowerCase()
  if (lowered.endsWith('.env.example')) return 'code'
  const slash = lowered.lastIndexOf('/')
  const name = slash >= 0 ? lowered.slice(slash + 1) : lowered
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return null
  const ext = name.slice(dot)
  if (DOCUMENTS_EXT.has(ext)) return 'documents'
  if (SPREADSHEETS_EXT.has(ext)) return 'spreadsheets'
  if (IMAGES_EXT.has(ext)) return 'images'
  if (CODE_EXT.has(ext)) return 'code'
  return null
}

function uniqueSorted(values: readonly string[] | undefined): string[] {
  return [...new Set(values ?? [])].sort()
}

function canonicalCategories(values: readonly DocumentCategory[] | undefined): DocumentCategory[] {
  const allowed = new Set(values ?? DEFAULT_ENABLED_CATEGORIES)
  return DOCUMENT_CATEGORIES.map(item => item.id).filter(id => allowed.has(id))
}

export function normalizePolicy(policy: IndexSummary['policy']): IndexPolicy {
  return {
    version: policy.version,
    paused: policy.paused,
    excluded_directories: uniqueSorted(policy.excluded_directories),
    excluded_files: uniqueSorted(policy.excluded_files),
    included_files: uniqueSorted(policy.included_files),
    enabled_categories: canonicalCategories(policy.enabled_categories),
    agent_outputs: policy.agent_outputs ?? 'manual',
    scope_confirmed: policy.scope_confirmed,
  }
}

export function samePolicy(a: IndexPolicy, b: IndexPolicy): boolean {
  return a.paused === b.paused
    && a.scope_confirmed === b.scope_confirmed
    && a.agent_outputs === b.agent_outputs
    && uniqueSorted(a.excluded_directories).join('\n') === uniqueSorted(b.excluded_directories).join('\n')
    && uniqueSorted(a.excluded_files).join('\n') === uniqueSorted(b.excluded_files).join('\n')
    && uniqueSorted(a.included_files).join('\n') === uniqueSorted(b.included_files).join('\n')
    && canonicalCategories(a.enabled_categories).join('\n') === canonicalCategories(b.enabled_categories).join('\n')
}

export function isInsideDirectory(path: string, directory: string): boolean {
  return path === directory || path.startsWith(`${directory}/`)
}

export function excludeFile(policy: IndexPolicy, path: string): IndexPolicy {
  return {
    ...policy,
    excluded_files: uniqueSorted([...(policy.excluded_files ?? []), path]),
    included_files: (policy.included_files ?? []).filter(item => item !== path),
  }
}

export function includeFile(policy: IndexPolicy, path: string, needsExplicitInclude: boolean): IndexPolicy {
  return {
    ...policy,
    excluded_files: (policy.excluded_files ?? []).filter(item => item !== path),
    included_files: needsExplicitInclude
      ? uniqueSorted([...(policy.included_files ?? []), path])
      : (policy.included_files ?? []).filter(item => item !== path),
  }
}

export function excludeDirectory(policy: IndexPolicy, directory: string): IndexPolicy {
  return {
    ...policy,
    excluded_directories: uniqueSorted([...(policy.excluded_directories ?? []), directory]),
    included_files: (policy.included_files ?? []).filter(item => !isInsideDirectory(item, directory)),
  }
}

export function includeDirectory(policy: IndexPolicy, directory: string): IndexPolicy {
  return {
    ...policy,
    excluded_directories: (policy.excluded_directories ?? []).filter(item => item !== directory),
  }
}

export function toggleCategory(policy: IndexPolicy, category: DocumentCategory, enabled: boolean): IndexPolicy {
  const current = new Set(policy.enabled_categories ?? DEFAULT_ENABLED_CATEGORIES)
  if (enabled) current.add(category)
  else current.delete(category)
  return {
    ...policy,
    enabled_categories: canonicalCategories([...current]),
  }
}

export function setAgentOutputs(policy: IndexPolicy, mode: AgentOutputPolicy): IndexPolicy {
  return {...policy, agent_outputs: mode}
}

export type FileIndexAction = {kind: 'include'; needsExplicitInclude: boolean} | {kind: 'exclude'}

export function fileIndexAction(path: string, summary: IndexSummary): FileIndexAction | null {
  const category = categoryForPath(path)
  if (!category) return null
  const policy = normalizePolicy(summary.policy)
  const inExcludedFiles = (policy.excluded_files ?? []).includes(path)
  const inIncludedFiles = (policy.included_files ?? []).includes(path)
  const inExcludedDir = (policy.excluded_directories ?? []).some(dir => isInsideDirectory(path, dir))
  const categoryEnabled = (policy.enabled_categories ?? DEFAULT_ENABLED_CATEGORIES).includes(category)
  const isPendingOutput = (summary.scan.pending_outputs ?? []).includes(path)
  const currentlyAllowed = !inExcludedFiles && (inIncludedFiles || (!inExcludedDir && categoryEnabled && !isPendingOutput))
  if (currentlyAllowed) return {kind: 'exclude'}
  return {kind: 'include', needsExplicitInclude: inExcludedDir || !categoryEnabled || isPendingOutput}
}

export function directoryIndexAction(directory: string, summary: IndexSummary): 'include' | 'exclude' {
  return (summary.policy.excluded_directories ?? []).includes(directory) ? 'include' : 'exclude'
}
