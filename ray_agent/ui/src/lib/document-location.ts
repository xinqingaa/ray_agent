import type {DocumentLocator} from '@/lib/api/documents'

export function sourceLocation(locator?: DocumentLocator | null): string {
  if (!locator) return ''
  if (locator.sheet) return [locator.sheet, locator.cell_range].filter(Boolean).join(' · ')
  if (locator.cell_range) return locator.cell_range
  if (locator.page != null) return `第 ${locator.page} 页`
  if (locator.slide != null) return `第 ${locator.slide} 张幻灯片`
  if (locator.line_start != null) return locator.line_end && locator.line_end !== locator.line_start
    ? `第 ${locator.line_start}–${locator.line_end} 行` : `第 ${locator.line_start} 行`
  if (locator.table != null) return `表格 ${locator.table + 1}`
  if (locator.block != null || locator.block_ordinal != null) return `第 ${(locator.block ?? locator.block_ordinal ?? 0) + 1} 块`
  return ''
}
