'use client'

import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {useRouter} from 'next/navigation'
import {toast} from 'sonner'
import {ChatInput} from '@/components/chat-input'
import {DeveloperView} from '@/components/developer/developer-view'
import {ContextRing} from '@/components/run/context-ring'
import {PlanBar} from '@/components/run/plan-bar'
import {RunStatusBar} from '@/components/run/status-bar'
import {Timeline, type TimelineHandlers} from '@/components/run/timeline-item'
import {downloadSessionFile, tabForFamily, Workbench, type WorkbenchTab} from '@/components/workbench/workbench'
import {VNCOverlay} from '@/components/vnc-overlay'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {useSessionDetail} from '@/hooks/use-session-detail'
import {useIsMobile} from '@/hooks/use-mobile'
import type {FileInfo} from '@/lib/api/types'
import type {FileView, TimelineItem, ToolCallView, ToolFamily} from '@/lib/session-view'

export interface SessionDetailViewProps {
  sessionId: string
  initialMessage?: string
  initialAttachments?: string[]
  hasInitialMessage?: boolean
}

function collectCalls(items: TimelineItem[]): ToolCallView[] {
  const calls: ToolCallView[] = []
  for (const item of items) {
    if (item.kind === 'tools') calls.push(...item.calls)
    else if (item.kind === 'approval') calls.push(item.call)
  }
  return calls
}

function lastOf(calls: ToolCallView[], family: ToolFamily): ToolCallView | null {
  for (let i = calls.length - 1; i >= 0; i--) {
    if (calls[i].family === family) return calls[i]
  }
  return null
}

export function SessionDetailView({
  sessionId,
  initialMessage,
  initialAttachments,
  hasInitialMessage,
}: SessionDetailViewProps) {
  const router = useRouter()
  const isMobile = useIsMobile()
  const {
    view,
    loading,
    error,
    refresh,
    sendMessage,
    submitting,
    stop,
    loadTurnRequest,
  } = useSessionDetail(sessionId, hasInitialMessage)

  const [mode, setMode] = useState<'conversation' | 'developer'>('conversation')
  const [pinnedCallId, setPinnedCallId] = useState<string | null>(null)
  const [workbenchOpen, setWorkbenchOpen] = useState(false)
  const [wide, setWide] = useState<boolean | null>(null)
  const [appliedWide, setAppliedWide] = useState(false)
  const [tab, setTab] = useState<WorkbenchTab>('terminal')
  const [tabForId, setTabForId] = useState<string | null>(null)
  const [highlightFileId, setHighlightFileId] = useState<string | null>(null)
  const [vncOpen, setVncOpen] = useState(false)
  const initialSentRef = useRef(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)

  const calls = useMemo(() => collectCalls(view?.timeline ?? []), [view])
  const latest = calls.length > 0 ? calls[calls.length - 1] : null
  const pin = pinnedCallId && calls.some((call) => call.callId === pinnedCallId) ? pinnedCallId : null
  const focus = pin ? calls.find((call) => call.callId === pin) ?? latest : latest
  const following = pin == null
  const focusId = focus?.callId ?? null
  const shellCall = focus?.family === 'shell' ? focus : lastOf(calls, 'shell')
  const browserCall = focus?.family === 'browser' ? focus : lastOf(calls, 'browser')
  const run = view && view.runs.length > 0 ? view.runs[view.runs.length - 1] : null

  if (focusId !== tabForId) {
    setTabForId(focusId)
    if (focus) setTab(tabForFamily(focus.family))
  }
  if (!appliedWide && wide === true && calls.length > 0) {
    setAppliedWide(true)
    setWorkbenchOpen(true)
  } else if (!appliedWide && wide === false) {
    setAppliedWide(true)
  }

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)')
    const apply = () => setWide(mq.matches)
    const frame = window.requestAnimationFrame(apply)
    mq.addEventListener('change', apply)
    return () => {
      window.cancelAnimationFrame(frame)
      mq.removeEventListener('change', apply)
    }
  }, [])

  useEffect(() => {
    if (!stickRef.current || vncOpen) return
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({top: el.scrollHeight, behavior: 'auto'})
  }, [view?.timeline.length, view?.status, vncOpen])

  useEffect(() => {
    if (!initialMessage || initialSentRef.current || !view || loading || submitting) return
    initialSentRef.current = true
    sendMessage(initialMessage, initialAttachments ?? []).then(() => {
      window.setTimeout(() => router.replace(`/sessions/${sessionId}`), 100)
    }).catch((err: unknown) => {
      toast.error(err instanceof Error ? err.message : '发送消息失败')
    })
  }, [initialMessage, initialAttachments, view, loading, submitting, sendMessage, sessionId, router])

  const handleStop = useCallback(async () => {
    try {
      await stop()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '停止失败')
    }
  }, [stop])

  const handleSend = useCallback(async (message: string, uploaded: FileInfo[]) => {
    try {
      await sendMessage(message, uploaded.map((file) => file.id))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '发送失败，请重试')
      throw err
    }
  }, [sendMessage])

  const downloadOne = useCallback(async (file: FileView) => {
    try {
      await downloadSessionFile(file)
      toast.success(`已下载「${file.filename}」`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '下载失败')
    }
  }, [])

  const downloadAll = useCallback(async (files: FileView[]) => {
    for (const file of files) {
      try {
        await downloadSessionFile(file)
      } catch (err) {
        toast.error(`「${file.filename}」下载失败：${err instanceof Error ? err.message : '未知错误'}`)
        return
      }
    }
    if (files.length > 0) toast.success(`已下载 ${files.length} 个文件`)
  }, [])

  const handlers = useMemo<TimelineHandlers>(() => ({
    selectedCallId: focus?.callId ?? null,
    onOpenCall: (callId) => {
      setPinnedCallId(callId)
      setWorkbenchOpen(true)
    },
    onPreviewFile: (file) => {
      setHighlightFileId(file.id)
      setTab('files')
      setWorkbenchOpen(true)
    },
    onDownloadFile: (file) => {
      void downloadOne(file)
    },
    onDownloadAll: (files) => {
      void downloadAll(files)
    },
    onRetry: view?.activeRun || submitting ? undefined : (text) => {
      void sendMessage(text, []).catch((err: unknown) => {
        toast.error(err instanceof Error ? err.message : '重试失败')
      })
    },
  }), [focus?.callId, view?.activeRun, submitting, downloadOne, downloadAll, sendMessage])

  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

  if (loading && !view) {
    return (
      <div className="flex h-full flex-1 items-center justify-center px-4">
        <p className="text-sm text-muted-foreground">{hasInitialMessage ? '正在创建任务' : '正在读取会话'}</p>
      </div>
    )
  }

  if (error && !view) {
    return (
      <div className="flex h-full flex-1 flex-col items-center justify-center gap-2 px-4">
        <p className="text-sm text-state-failed">{error.message}</p>
        <button
          type="button"
          onClick={() => void refresh()}
          className="rounded-sm text-sm text-signal underline outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          重新读取
        </button>
      </div>
    )
  }

  if (!view) {
    return (
      <div className="flex h-full flex-1 items-center justify-center px-4">
        <p className="text-sm text-muted-foreground">未找到该任务</p>
      </div>
    )
  }

  const placeholder = view.status === 'waiting'
    ? '回复将继续当前任务'
    : view.status === 'running'
      ? '补充要求，会在当前这批操作结束后读取'
      : '描述下一步，或开始一次新的运行'

  const workbench = (
    <Workbench
      sessionId={sessionId}
      focus={focus}
      following={following}
      shellCall={shellCall}
      browserCall={browserCall}
      files={view.files}
      tab={tab}
      onTab={setTab}
      highlightFileId={highlightFileId}
      onFollowLatest={() => setPinnedCallId(null)}
      onClose={() => setWorkbenchOpen(false)}
      onOpenVnc={browserCall ? () => setVncOpen(true) : undefined}
      className={isMobile ? undefined : 'w-[min(40vw,26rem)] shrink-0 border-l'}
    />
  )

  return (
    <>
      <div className="flex h-full min-h-0 w-full overflow-hidden">
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
            <h1 className="min-w-0 flex-1 truncate text-sm font-medium" title={view.title || '新任务'}>
              {view.title || '新任务'}
            </h1>
            <div role="group" aria-label="会话视图" className="flex shrink-0 rounded-md border p-0.5">
              <button
                type="button"
                aria-pressed={mode === 'conversation'}
                onClick={() => setMode('conversation')}
                className={`rounded-sm px-2 py-1 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring ${mode === 'conversation' ? 'bg-muted font-medium' : 'text-muted-foreground'}`}
              >
                对话
              </button>
              <button
                type="button"
                aria-pressed={mode === 'developer'}
                onClick={() => setMode('developer')}
                className={`rounded-sm px-2 py-1 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring ${mode === 'developer' ? 'bg-muted font-medium' : 'text-muted-foreground'}`}
              >
                开发者
              </button>
            </div>
            <button
              type="button"
              aria-pressed={workbenchOpen}
              onClick={() => setWorkbenchOpen((open) => !open)}
              className="rounded-md border px-2 py-1 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              工作台
            </button>
          </header>

          <RunStatusBar run={run} onStop={() => void handleStop()}/>

          {mode === 'conversation' ? (
            <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto">
              <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 py-3">
                {view.timeline.length === 0 && (
                  <p className="py-8 text-center text-meta text-faint">
                    这里会显示你的消息、工具操作和最终回复。在下方输入任务后开始。
                  </p>
                )}
                <Timeline items={view.timeline} handlers={handlers}/>
              </div>
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <DeveloperView view={view} loadTurnRequest={loadTurnRequest} className="mx-auto w-full max-w-4xl"/>
            </div>
          )}

          <div className="shrink-0 border-t bg-background px-3 py-3">
            <div className="mx-auto w-full max-w-3xl">
              {mode === 'conversation' && (
                <PlanBar plan={view.plan} runStatus={view.status === 'idle' ? null : view.status} className="mb-2"/>
              )}
              <ChatInput
                sessionId={sessionId}
                onSend={handleSend}
                disabled={submitting}
                placeholder={placeholder}
                accessory={<ContextRing usage={view.usage}/>}
              />
            </div>
          </div>
        </div>

        {!isMobile && workbenchOpen && workbench}
      </div>

      {isMobile && (
        <Sheet open={workbenchOpen} onOpenChange={setWorkbenchOpen}>
          <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-md" showCloseButton={false}>
            <SheetHeader className="sr-only">
              <SheetTitle>工作台</SheetTitle>
              <SheetDescription>终端、浏览器和会话文件</SheetDescription>
            </SheetHeader>
            {workbench}
          </SheetContent>
        </Sheet>
      )}

      {vncOpen && <VNCOverlay sessionId={sessionId} onClose={() => setVncOpen(false)}/>}
    </>
  )
}
