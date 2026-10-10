import {
  File,
  FileArchive,
  FileCode,
  FileImage,
  FileJson,
  FileSpreadsheet,
  FileText,
  type LucideIcon,
} from 'lucide-react'

const BY_EXTENSION: Record<string, LucideIcon> = {
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

export function fileIcon(extension: string): LucideIcon {
  return BY_EXTENSION[normalizeExt(extension)] ?? File
}

const PREVIEWABLE = new Set([
  '.json', '.csv', '.tsv', '.md', '.mdx', '.markdown', '.txt', '.py', '.js', '.ts', '.tsx', '.html', '.htm', '.css', '.sh', '.yaml', '.yml', '.log',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.pdf', '.xlsx', '.xls',
  '.jsx', '.xml', '.sql', '.toml', '.ini', '.rst', '.diff',
])
const MARKDOWN_EXT = new Set(['.md', '.mdx', '.markdown'])
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp'])

export function previewBodyKind(extension: string): 'markdown' | 'text' | 'table' | 'image' | 'pdf' | 'unavailable' {
  const ext = normalizeExt(extension)
  if (!PREVIEWABLE.has(ext)) return 'unavailable'
  if (MARKDOWN_EXT.has(ext)) return 'markdown'
  if (IMAGE_EXT.has(ext)) return 'image'
  if (ext === '.pdf') return 'pdf'
  if (['.csv', '.tsv', '.xlsx', '.xls'].includes(ext)) return 'table'
  return 'text'
}

/** 工作台能预览的类型；不能预览时返回原因 */
export function previewUnavailableReason(extension: string): string | null {
  const ext = normalizeExt(extension)
  if (!PREVIEWABLE.has(ext)) return '仅下载'
  return null
}
