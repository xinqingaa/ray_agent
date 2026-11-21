import {useEffect} from 'react'
import {useRouter, usePathname} from '@/lib/navigation'
import {isDesktop, onOpenSession, setViewedSession} from '@/lib/platform'
import {viewedSessionId} from '@/lib/viewed-session'

/**
 * 桌面宿主的界面侧接口（不渲染内容）：把当前停留的会话告诉宿主，宿主据此决定任务完成通知是否需要发出；
 * 点击通知时打开对应会话。只在核心就绪后挂载。
 */
export function HostBridge() {
  const pathname = usePathname()
  const router = useRouter()
  const session = viewedSessionId(pathname)

  useEffect(() => {
    if (!isDesktop()) return
    void setViewedSession(session).catch(() => {/* 宿主不可用时不影响界面 */})
  }, [session])

  useEffect(() => {
    if (!isDesktop()) return
    let disposed = false
    const unlisten = onOpenSession(id => {
      if (!disposed) router.push(`/sessions/${encodeURIComponent(id)}`)
    })
    return () => {
      disposed = true
      void unlisten.then(stop => stop())
    }
  }, [router])

  useEffect(() => () => {
    if (isDesktop()) void setViewedSession(null).catch(() => {/* 忽略 */})
  }, [])

  return null
}
