import {useCallback, useEffect, useState} from 'react'
import {sessionApi} from '@/lib/api/session'
import {useSessions} from '@/providers/sessions-provider'

/** 按已加载的会话列表取标题；列表里没有（分页之外或属于别处）返回 null。 */
export function useSessionTitleLookup(): (sessionId: string | null | undefined) => string | null {
  const {sessions} = useSessions()
  return useCallback((sessionId) => {
    if (!sessionId) return null
    return sessions.find(item => item.session_id === sessionId)?.title || null
  }, [sessions])
}

/** 会话标题：先用列表，列表里没有时读取一次会话；读不到返回 null。 */
export function useSessionTitle(sessionId: string | null | undefined): string | null {
  const lookup = useSessionTitleLookup()
  const listed = lookup(sessionId)
  const [fetched, setFetched] = useState<{id: string; title: string} | null>(null)
  useEffect(() => {
    if (!sessionId || listed) return
    let cancelled = false
    sessionApi.getSession(sessionId)
      .then(session => {if (!cancelled) setFetched({id: sessionId, title: session.title ?? ''})})
      .catch(() => {})
    return () => {cancelled = true}
  }, [sessionId, listed])
  return listed ?? (fetched && fetched.id === sessionId ? fetched.title || null : null)
}
