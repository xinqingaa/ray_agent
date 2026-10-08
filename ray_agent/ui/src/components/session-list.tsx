'use client'

import {useCallback, useState} from 'react'
import {useParams, useRouter} from 'next/navigation'
import {toast} from 'sonner'
import {ItemGroup} from '@/components/ui/item'
import {SessionItem} from '@/components/session-item'
import {DeleteSessionDialog} from '@/components/delete-session-dialog'
import {RenameSessionDialog} from '@/components/rename-session-dialog'
import {useSessions} from '@/hooks/use-sessions'
import type {Session} from '@/lib/api'

/**
 * 会话列表组件
 * 负责渲染列表、处理路由导航及删除操作
 */
export function SessionList() {
  const router = useRouter()
  const params = useParams()
  const {sessions, loading, error, refresh, deleteSession, patchSession} = useSessions()

  // 待删除的会话
  const [pendingDeleteSession, setPendingDeleteSession] = useState<Session | null>(null)
  const [pendingRenameSession, setPendingRenameSession] = useState<Session | null>(null)
  const routeId = String(params?.id ?? '')
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [pendingRoute, setPendingRoute] = useState(routeId)
  if (routeId !== pendingRoute) {
    setPendingRoute(routeId)
    setPendingId(null)
  }
  const activeId = pendingId ?? routeId

  const handleSessionClick = useCallback((sessionId: string) => {
    setPendingId(sessionId)
  }, [])

  const handleDeleteRequest = useCallback((session: Session) => {
    setPendingDeleteSession(session)
  }, [])

  const handleDeleteConfirm = useCallback(async () => {
    if (!pendingDeleteSession) return

    const sessionTitle = pendingDeleteSession.title || '新任务'
    const success = await deleteSession(pendingDeleteSession.session_id)

    if (success) {
      toast.success(`已删除任务「${sessionTitle}」`)
      // 如果删除的是当前正在查看的会话，跳转到首页
      if (params?.id === pendingDeleteSession.session_id) {
        router.push('/')
      }
    } else {
      toast.error(`删除任务「${sessionTitle}」失败，请重试`)
    }

    setPendingDeleteSession(null)
  }, [pendingDeleteSession, deleteSession, params?.id, router])

  const handleDialogOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setPendingDeleteSession(null)
    }
  }, [])

  // 加载态：骨架屏
  if (loading) {
    return (
      <ItemGroup className="gap-2">
        {Array.from({length: 3}).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-2 p-2 animate-pulse"
          >
            <div className="size-8 rounded-full bg-muted"/>
            <div className="flex-1 space-y-1.5">
              <div className="h-3.5 bg-muted rounded w-3/4"/>
              <div className="h-3 bg-muted rounded w-1/2"/>
            </div>
          </div>
        ))}
      </ItemGroup>
    )
  }

  // 错误态
  if (error) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-sm text-muted-foreground">
        <p>加载失败</p>
        <button
          className="text-primary underline underline-offset-4 cursor-pointer"
          onClick={refresh}
        >
          重试
        </button>
      </div>
    )
  }

  // 空态
  if (sessions.length === 0) {
    return (
      <div className="px-2 py-8 text-center text-sm text-muted-foreground">
        <p>还没有会话</p>
        <p className="mt-1 text-xs text-faint">在首页发送任务后，会话会出现在这里，并标出运行中、等你回复、等你批准或失败。</p>
      </div>
    )
  }

  return (
    <>
      <ItemGroup className="gap-2">
        {sessions.map((session) => (
          <SessionItem
            key={session.session_id}
            session={session}
            href={`/sessions/${session.session_id}`}
            isActive={session.session_id === activeId}
            onClick={handleSessionClick}
            onDelete={handleDeleteRequest}
            onRename={setPendingRenameSession}
          />
        ))}
      </ItemGroup>

      {/* 删除确认弹窗 */}
      <DeleteSessionDialog
        open={!!pendingDeleteSession}
        onOpenChange={handleDialogOpenChange}
        onConfirm={handleDeleteConfirm}
      />
      {pendingRenameSession && <RenameSessionDialog sessionId={pendingRenameSession.session_id} currentTitle={pendingRenameSession.title} open
        onOpenChange={(open) => {if (!open) setPendingRenameSession(null)}}
        onSaved={(title) => patchSession(pendingRenameSession.session_id, {title})}/>}
    </>
  )
}
