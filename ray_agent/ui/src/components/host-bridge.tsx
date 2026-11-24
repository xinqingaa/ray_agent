import {useEffect} from 'react'
import {toast} from 'sonner'
import {useRouter, usePathname} from '@/lib/navigation'
import {isDesktop, onDownloadResult, onOpenSession, setViewedSession} from '@/lib/platform'
import {viewedSessionId} from '@/lib/viewed-session'

/**
 * 桌面宿主的界面侧接口（不渲染内容）：把当前停留的会话告诉宿主，宿主据此决定任务完成通知是否需要发出；
 * 点击通知时打开对应会话，并承接宿主原生下载完成/失败提示。只在核心就绪后挂载。
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

  useEffect(() => {
    if (!isDesktop()) return
    let disposed = false
    const unlisten = onDownloadResult(result => {
      if (disposed) return
      if (result.ok) toast.success(result.filename ? `已保存「${result.filename}」` : '文件已保存')
      else toast.error(result.message || '文件下载失败')
    })
    return () => {
      disposed = true
      void unlisten.then(stop => stop())
    }
  }, [])

  useEffect(() => () => {
    if (isDesktop()) void setViewedSession(null).catch(() => {/* 忽略 */})
  }, [])

  return null
}
