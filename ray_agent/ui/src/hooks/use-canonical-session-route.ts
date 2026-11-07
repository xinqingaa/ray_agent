import {useEffect} from 'react'
import {useRouter} from '@/lib/navigation'
import {sessionApi} from '@/lib/api/session'
import {workspaceSessionHref} from '@/lib/workspace-route'

/**
 * 会话只有一个规范地址：独立对话是 `/sessions/:id`，工作区会话是 `/workspaces/:wid/sessions/:id`。
 * 地址与会话实际归属不一致（旧链接、手输地址）时就地改写，不留历史记录。
 */
export function useCanonicalSessionRoute(sessionId: string, workspaceId: string | null) {
  const router = useRouter()
  useEffect(() => {
    let active = true
    sessionApi.getSession(sessionId).then(session => {
      const actual = session.workspace_id ?? null
      if (!active || actual === workspaceId) return
      router.replace(actual ? workspaceSessionHref(actual, sessionId) : `/sessions/${encodeURIComponent(sessionId)}`)
    }).catch(() => {/* 读取失败由会话视图自己呈现 */})
    return () => {active = false}
  }, [sessionId, workspaceId, router])
}
