'use client'
import {forwardRef, useEffect, useState} from 'react'
import {Loader2} from 'lucide-react'
import {Dialog, DialogContent, DialogTitle} from '@/components/ui/dialog'
import {SkillReader} from '@/components/skill-reader'
import {skillsApi, type SkillDetail} from '@/lib/api/skills'
import {cn} from '@/lib/utils'

/** 名称是一整段：高亮可点，点击打开只读预览，选中时不能拆进字中间。 */
export const SkillMark = forwardRef<HTMLButtonElement, {name: string; className?: string; onRemove?: () => void; onExit?: () => void}>(function SkillMark({name, className, onRemove, onExit}, ref) {
  const [open, setOpen] = useState(false)
  return <>
    <button
      ref={ref}
      type="button"
      className={cn('inline-block max-w-full cursor-pointer truncate align-baseline rounded-sm text-sm font-normal leading-relaxed text-signal select-all outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring', className)}
      aria-label={`预览 ${name}`}
      onClick={() => setOpen(true)}
      onKeyDown={event => {
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {event.preventDefault(); onExit?.(); return}
        if (onRemove && (event.key === 'Backspace' || event.key === 'Delete')) {event.preventDefault(); onRemove(); onExit?.()}
      }}
    >{name}</button>
    <SkillPreviewDialog name={open ? name : null} onClose={() => {setOpen(false); onExit?.()}}/>
  </>
})

function SkillPreviewDialog({name, onClose}: {name: string | null; onClose: () => void}) {
  const [detail, setDetail] = useState<SkillDetail | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!name) return
    let disposed = false
    setDetail(null); setError('')
    skillsApi.detail(name).then(data => {if (!disposed) setDetail(data)}).catch(reason => {if (!disposed) setError(reason instanceof Error ? reason.message : '无法打开预览')})
    return () => {disposed = true}
  }, [name])
  return <Dialog open={!!name} onOpenChange={open => {if (!open) onClose()}}>
    <DialogContent aria-describedby={undefined} className="flex h-[min(42rem,calc(100dvh-3rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl motion-reduce:animate-none">
      <div className="shrink-0 px-6 pb-4 pt-6 pr-14"><DialogTitle className="min-w-0 break-all leading-snug">{name}</DialogTitle></div>
      {error ? <p role="alert" className="px-6 pb-6 text-sm text-state-failed">{error}</p> : detail ? <SkillReader skill={detail}/> : <div role="status" className="flex flex-1 items-center justify-center pb-8"><Loader2 className="size-5 animate-spin text-muted-foreground"/><span className="sr-only">正在打开预览</span></div>}
    </DialogContent>
  </Dialog>
}
