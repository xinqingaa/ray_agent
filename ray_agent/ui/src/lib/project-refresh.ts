import type {SSEEventData, ToolEvent} from '@/lib/api/types'

/** 写操作的尾沿合并刷新；非工具事件不撤销已排入的刷新。 */
export function createProjectRefreshWatcher(refresh: () => void, delay = 1000) {
  const observed = new Set<string>()
  let timer: ReturnType<typeof setTimeout> | null = null
  let disposed = false
  return {
    observe(events: SSEEventData[]) {
      if (disposed) return
      let changed = false
      for (const event of events) {
        if (event.type !== 'tool') continue
        const data = event.data as ToolEvent
        if (data.status !== 'called') continue
        const fn = data.function ?? data.name ?? ''
        if (fn !== 'write_file' && fn !== 'replace_in_file' && fn !== 'update_project_notes' && fn !== 'deliver_files' && !fn.startsWith('shell_') && !fn.startsWith('browser_') && data.name !== 'mcp' && data.name !== 'a2a') continue
        const key = JSON.stringify(event)
        if (observed.has(key)) continue
        observed.add(key)
        changed = true
      }
      if (!changed) return
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(() => {timer = null; if (!disposed) refresh()}, delay)
    },
    dispose() {
      disposed = true
      if (timer !== null) clearTimeout(timer)
      timer = null
      observed.clear()
    },
  }
}
