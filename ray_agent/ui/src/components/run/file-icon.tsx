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
  '.txt': FileText,
  '.pdf': FileText,
  '.docx': FileText,
  '.png': FileImage,
  '.jpg': FileImage,
  '.jpeg': FileImage,
  '.gif': FileImage,
  '.webp': FileImage,
  '.svg': FileImage,
  '.zip': FileArchive,
  '.tar': FileArchive,
  '.gz': FileArchive,
  '.py': FileCode,
  '.js': FileCode,
  '.ts': FileCode,
  '.tsx': FileCode,
  '.html': FileCode,
  '.css': FileCode,
  '.sh': FileCode,
}

export function fileIcon(extension: string): LucideIcon {
  const ext = extension.startsWith('.') ? extension.toLowerCase() : `.${extension.toLowerCase()}`
  return BY_EXTENSION[ext] ?? File
}

const PREVIEWABLE = new Set([
  '.json', '.csv', '.tsv', '.md', '.txt', '.py', '.js', '.ts', '.tsx', '.html', '.css', '.sh', '.yaml', '.yml', '.log',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.pdf',
])

/** 工作台能预览的类型；不能预览时返回原因 */
export function previewUnavailableReason(extension: string, size: number | null): string | null {
  const ext = extension.startsWith('.') ? extension.toLowerCase() : `.${extension.toLowerCase()}`
  if (!PREVIEWABLE.has(ext)) return `${ext || '该'} 类型不支持预览，可下载后查看`
  if (size != null && size > 5 * 1024 * 1024) return '文件超过 5 MB，不在页面内预览'
  return null
}
