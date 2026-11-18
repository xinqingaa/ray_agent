import {useEffect, useState} from 'react'
import {Command, CommandInput, CommandItem, CommandList} from '@/components/ui/command'
import {Dialog, DialogContent, DialogDescription, DialogTitle} from '@/components/ui/dialog'
import {Button} from '@/components/ui/button'
import {MessageCircle} from '@/components/ui/icons'
import {useRouter} from '@/lib/navigation'
import {sessionApi} from '@/lib/api/session'
import type {Session} from '@/lib/api/types'
import {workspaceSessionHref} from '@/lib/workspace-route'
import {sessionScope} from '@/lib/workspace-state'

export function ConversationSearch({open, onOpenChange, workspaceId, onRestoreFocus}: {
  open: boolean; onOpenChange: (open: boolean) => void; workspaceId: string | null; onRestoreFocus: () => void
}) {
  const router = useRouter()
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const [query, setQuery] = useState('')
  const scopeLabel = workspaceId ? '当前工作区' : '独立对话'

  useEffect(() => {
    if (!open) return
    let cancelled = false
    const read = async () => {
      setSessions([])
      setLoading(true)
      setError(null)
      const unique = new Map<string, Session>()
      try {
        let offset = 0
        for (;;) {
          const page = await sessionApi.getSessions(offset, sessionScope(workspaceId))
          if (cancelled) return
          for (const session of page.sessions) unique.set(session.session_id, session)
          setSessions([...unique.values()])
          offset = page.offset + page.sessions.length
          if (!page.sessions.length || offset >= page.total) break
        }
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : '读取对话失败')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void read()
    return () => {cancelled = true}
  }, [open, retry, workspaceId])

  const term = query.trim().toLocaleLowerCase()
  const results = sessions.filter(session => (session.title || '新对话').toLocaleLowerCase().includes(term))

  return <Dialog open={open} onOpenChange={next => {if (!next) setQuery(''); onOpenChange(next)}}>
    <DialogContent className="gap-0 overflow-hidden p-0" showCloseButton={false}
      onCloseAutoFocus={event => {event.preventDefault(); onRestoreFocus()}}>
      <DialogTitle className="sr-only">搜索对话</DialogTitle>
      <DialogDescription className="sr-only">按标题搜索{scopeLabel}中的对话</DialogDescription>
      <Command shouldFilter={false}>
        <CommandInput value={query} onValueChange={setQuery} placeholder={`搜索${scopeLabel}的对话标题`}/>
        <CommandList className="min-h-24 p-2">
          {results.map(session => <CommandItem key={session.session_id} value={session.session_id}
            onSelect={() => {
              setQuery('')
              onOpenChange(false)
              router.push(workspaceId ? workspaceSessionHref(workspaceId, session.session_id) : `/sessions/${encodeURIComponent(session.session_id)}`)
            }}><MessageCircle/>{session.title || '新对话'}</CommandItem>)}
          {!loading && !error && !results.length && <p className="p-4 text-center text-sm text-muted-foreground">{term ? '没有匹配的对话' : '还没有对话'}</p>}
        </CommandList>
        {loading && <p className="border-t px-4 py-2 text-meta text-muted-foreground" role="status">正在读取对话…</p>}
        {error && <div className="flex items-center gap-3 border-t px-4 py-2 text-meta text-state-failed" role="alert">
          {error}<Button variant="ghost" size="xs" onClick={() => setRetry(value => value + 1)}>重试</Button>
        </div>}
      </Command>
    </DialogContent>
  </Dialog>
}
