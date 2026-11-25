import {File, FileText, type UiIcon, FileArchive, FileCode, FileImage, FileJson, FileSpreadsheet} from '@/components/ui/icons'

const BY_EXTENSION: Record<string, UiIcon> = {
  '.json': FileJson,
  '.csv': FileSpreadsheet,
  '.tsv': FileSpreadsheet,
  '.xlsx': FileSpreadsheet,
  '.xls': FileSpreadsheet,
  '.md': FileText,
  '.mdx': FileText,
  '.markdown': FileText,
  '.txt': FileText,
  '.pdf': FileText,
  '.doc': FileText,
  '.docx': FileText,
  '.png': FileImage,
  '.jpg': FileImage,
  '.jpeg': FileImage,
  '.gif': FileImage,
  '.webp': FileImage,
  '.svg': FileImage,
  '.bmp': FileImage,
  '.zip': FileArchive,
  '.tar': FileArchive,
  '.gz': FileArchive,
  '.py': FileCode,
  '.js': FileCode,
  '.ts': FileCode,
  '.tsx': FileCode,
  '.html': FileCode,
  '.htm': FileCode,
  '.css': FileCode,
  '.sh': FileCode,
}

function normalizeExt(extension: string): string {
  if (!extension) return ''
  const lower = extension.toLowerCase()
  return lower.startsWith('.') ? lower : `.${lower}`
}

export function fileExtension(path: string) {
  const filename = path.split(/[\\/]/).at(-1) ?? path
  const dot = filename.lastIndexOf('.')
  return dot > 0 ? filename.slice(dot) : ''
}

export function fileIcon(extension: string): UiIcon {
  return BY_EXTENSION[normalizeExt(extension)] ?? File
}

const BADGES: Record<string, readonly [label: string, tone: string]> = {
  '.pdf': ['PDF', 'rose'], '.xlsx': ['XLS', 'green'], '.xls': ['XLS', 'green'],
  '.csv': ['CSV', 'green'], '.tsv': ['TSV', 'green'], '.doc': ['DOC', 'blue'], '.docx': ['DOC', 'blue'],
  '.md': ['MD', 'slate'], '.mdx': ['MD', 'slate'], '.markdown': ['MD', 'slate'], '.txt': ['TXT', 'slate'],
  '.json': ['{ }', 'amber'],
}

export function FileTypeBadge({extension, compact = false}: {extension: string; compact?: boolean}) {
  const ext = normalizeExt(extension)
  const [label, tone] = BADGES[ext] ?? (IMAGE_EXT.has(ext) ? ['IMG', 'violet'] : [ext.slice(1, 4).toUpperCase(), 'slate'])
  return <span aria-hidden="true" data-tone={tone} data-compact={compact} className="file-type-badge">
    {label || <File className="size-3.5"/>}
  </span>
}

const PREVIEWABLE = new Set([
  '.json', '.csv', '.tsv', '.md', '.mdx', '.markdown', '.txt', '.py', '.js', '.ts', '.tsx', '.html', '.htm', '.css', '.sh', '.yaml', '.yml', '.log',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.pdf', '.xlsx', '.xls',
  '.jsx', '.xml', '.sql', '.toml', '.ini', '.rst', '.diff', '.doc', '.docx',
])
const MARKDOWN_EXT = new Set(['.md', '.mdx', '.markdown'])
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp'])

export function previewBodyKind(extension: string): 'markdown' | 'text' | 'table' | 'image' | 'pdf' | 'docx' | 'unavailable' {
  const ext = normalizeExt(extension)
  if (!PREVIEWABLE.has(ext)) return 'unavailable'
  if (MARKDOWN_EXT.has(ext)) return 'markdown'
  if (IMAGE_EXT.has(ext)) return 'image'
  if (ext === '.pdf') return 'pdf'
  if (ext === '.docx' || ext === '.doc') return 'docx'
  if (['.csv', '.tsv', '.xlsx', '.xls'].includes(ext)) return 'table'
  return 'text'
}

/** 工作台能预览的类型；不能预览时返回原因 */
export function previewUnavailableReason(extension: string): string | null {
  const ext = normalizeExt(extension)
  if (!PREVIEWABLE.has(ext)) return '仅下载'
  return null
}
