'use client'

import {useEffect, useRef, useState} from 'react'
import {Sparkles} from 'lucide-react'
import {toast} from 'sonner'
import {Button} from '@/components/ui/button'
import {Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle} from '@/components/ui/dialog'
import {sessionApi} from '@/lib/api/session'
import type {Session} from '@/lib/api'

type Props = {
  session: Session
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: (title: string) => void
}

export function RenameSessionDialog({session, open, onOpenChange, onSaved}: Props) {
  const [title, setTitle] = useState(session.title)
  const [suggesting, setSuggesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const wasOpen = useRef(false)

  useEffect(() => {
    if (open && !wasOpen.current) setTitle(session.title)
    wasOpen.current = open
  }, [open, session.title])

  const suggest = async () => {
    const titleBeforeRequest = title
    setSuggesting(true)
    try {
      const result = await sessionApi.suggestTitle(session.session_id)
      setTitle((current) => current === titleBeforeRequest ? result.title : current)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '生成标题失败')
    } finally {
      setSuggesting(false)
    }
  }

  const save = async () => {
    if (!title.trim() || saving) return
    setSaving(true)
    try {
      const result = await sessionApi.renameTitle(session.session_id, title.trim())
      onSaved(result.title)
      onOpenChange(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '重命名失败')
    } finally {
      setSaving(false)
    }
  }

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="sm:max-w-[440px]">
      <DialogHeader>
        <DialogTitle>重命名会话</DialogTitle>
        <DialogDescription>写一个简短标题，便于在侧边栏找到这段会话。</DialogDescription>
      </DialogHeader>
      <div className="relative">
        <input
          autoFocus
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {if (event.key === 'Enter') void save()}}
          maxLength={255}
          dir="auto"
          aria-label="会话标题"
          className="h-10 w-full rounded-md border bg-background pr-11 pl-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <Button type="button" size="icon-xs" variant="ghost" title="用 AI 生成标题建议" aria-label="用 AI 生成标题建议"
          disabled={suggesting || saving} onClick={() => void suggest()}
          className="absolute top-1 right-1 size-8 text-signal">
          <Sparkles className={suggesting ? 'animate-pulse' : ''}/>
        </Button>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>取消</Button>
        <Button onClick={() => void save()} disabled={!title.trim() || saving || suggesting}>{saving ? '保存中…' : '保存'}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
}
