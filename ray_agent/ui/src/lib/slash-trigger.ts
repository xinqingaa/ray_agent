/** `/` 提示的触发判定与片段移除。菜单组件不解释这些规则。 */

export type SlashFragment = {
  /** `/` 在原文中的下标 */
  start: number
  /** 片段结束下标（不含）。包含 `/` 及其后连续非空白字符 */
  end: number
  /** `/` 之后的连续非空白字符，可为空 */
  query: string
}

const WHITESPACE = /\s/u

function isWhitespace(char: string): boolean {
  return WHITESPACE.test(char)
}

/**
 * 光标所在的连续非空白片段以 `/` 开头，且该 `/` 在输入开头或紧跟空白时返回片段。
 * 路径中的 `/`（前面不是空白）不触发。组合输入期间不触发。
 */
export function findSlashTrigger(
  text: string,
  cursor: number,
  composing: boolean,
): SlashFragment | null {
  if (composing) return null
  if (!Number.isInteger(cursor) || cursor < 0 || cursor > text.length) return null

  let tokenStart = cursor
  while (tokenStart > 0 && !isWhitespace(text[tokenStart - 1] ?? '')) tokenStart -= 1
  if (tokenStart === cursor) return null
  if (text[tokenStart] !== '/') return null

  let tokenEnd = tokenStart + 1
  while (tokenEnd < text.length && !isWhitespace(text[tokenEnd] ?? '')) tokenEnd += 1
  if (cursor <= tokenStart || cursor > tokenEnd) return null

  return {
    start: tokenStart,
    end: tokenEnd,
    query: text.slice(tokenStart + 1, tokenEnd),
  }
}

/** 删掉触发提示的 `/xxx` 片段，其余文字保留，光标落在片段原来的位置。 */
export function removeSlashFragment(
  text: string,
  cursor: number,
  fragment: Pick<SlashFragment, 'start' | 'end'>,
): {text: string; cursor: number} {
  const {start, end} = fragment
  if (start < 0 || end < start || start > text.length || end > text.length) {
    return {text, cursor: clampCursor(cursor, text.length)}
  }
  const next = text.slice(0, start) + text.slice(end)
  const removed = end - start
  let nextCursor = cursor
  if (cursor >= end) nextCursor = cursor - removed
  else if (cursor > start) nextCursor = start
  return {text: next, cursor: clampCursor(nextCursor, next.length)}
}

function clampCursor(cursor: number, length: number): number {
  if (!Number.isFinite(cursor)) return 0
  if (cursor < 0) return 0
  if (cursor > length) return length
  return cursor
}

/** 空查询匹配全部。否则对关键字、别名、搜索词和标题做不区分大小写的包含判断。 */
export function matchesCommandQuery(query: string, fields: readonly string[]): boolean {
  if (query === '') return true
  const needle = query.toLowerCase()
  return fields.some((field) => field.toLowerCase().includes(needle))
}
