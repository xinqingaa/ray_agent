import type {FileView} from './session-view'

/** 只关联已交付的文件；路径来自消息发生时的快照，不能使用会话的最新文件列表。 */
export function resolveMessageFileLink(href: string, files: readonly FileView[]): FileView | 'unavailable' | null {
  const explicit = /^(?:sandbox:|file:)/i.test(href)
  let path = href
  if (/^file:/i.test(path)) {
    try {
      const url = new URL(path)
      if (url.hostname && url.hostname !== 'localhost') return 'unavailable'
      path = url.pathname
    } catch { return 'unavailable' }
  } else if (/^sandbox:/i.test(path)) {
    path = path.slice('sandbox:'.length)
  } else if (!path.startsWith('/') || path.startsWith('//')) {
    return null
  }
  path = path.split(/[?#]/, 1)[0]
  try { path = decodeURIComponent(path) } catch { return explicit ? 'unavailable' : null }
  const candidates = files.filter(file => file.source === 'delivery' && file.path === path)
  if (new Set(candidates.map(file => file.id)).size > 1) return 'unavailable'
  if (candidates.length) return candidates[0]
  // 沙箱的用户目录、临时目录和挂载目录不是网站路由。其他网页链接不改写。
  return explicit || /^\/(?:home|tmp|workspace|mnt)\//.test(path) ? 'unavailable' : null
}
