'use client'

import {useCallback, useEffect, useId, useRef, useState} from 'react'
import {ChevronUp, Circle, CircleCheck, CircleDot} from 'lucide-react'
import {cn} from '@/lib/utils'
import type {PlanItem, PlanView, RunStatus} from '@/lib/session-view'

type PlanBarProps = {
  plan: PlanView | null
  runStatus?: RunStatus | null
  /** 计划模式结束后等待确认执行的清单：不显示进度，只列出步骤 */
  proposal?: boolean
  defaultOpen?: boolean
  className?: string
}

const STATUS_TEXT = {pending: '未开始', in_progress: '进行中', completed: '已完成'}

function ItemIcon({item, ended}: {item: PlanItem; ended: boolean}) {
  if (item.status === 'completed') return <CircleCheck className="size-4 text-state-success" aria-hidden/>
  if (item.status === 'in_progress' && !ended) return <CircleDot className="size-4 text-signal" aria-hidden/>
  return <Circle className={cn('size-4', ended ? 'text-state-waiting' : 'text-faint')} aria-hidden/>
}

/** 浮动展开卡片只展示最新快照；事件历史仍可在开发者视图核对。 */
export function PlanContent({plan, active, ended}: {plan: PlanView; active: boolean; ended: boolean}) {
  return <>
    <p className="mb-2 text-xs text-muted-foreground tabular-nums">已完成 {plan.completedCount}/{plan.items.length} 项</p>
    {plan.explanation && <p className="mb-2 text-meta text-muted-foreground">{plan.explanation}</p>}
    <ol className="space-y-0.5">
      {plan.items.map((item, i) => {
        const isCurrent = i === plan.currentIndex && active
        return (
          <li key={item.id} aria-current={isCurrent ? 'step' : undefined} className={cn('flex items-start gap-2 rounded-md py-1 pr-1 pl-2', isCurrent && 'bg-signal-soft/60')}>
            <span className="w-4 shrink-0 pt-px text-right text-xs tabular-nums text-faint">{i + 1}</span>
            <span className="pt-0.5"><ItemIcon item={item} ended={ended || plan.progressState === 'unconfirmed' || plan.progressState === 'preparing'}/></span>
            <span className={cn('min-w-0 flex-1 text-meta break-words', item.status === 'completed' ? 'text-muted-foreground' : 'text-foreground', isCurrent && 'font-medium')}>{item.text}</span>
            <span className={cn('shrink-0 text-xs', isCurrent ? 'text-signal' : 'text-muted-foreground')}>
              {plan.progressState === 'preparing' && item.status !== 'completed' ? '未开始' : plan.progressState === 'unconfirmed' && item.status !== 'completed' ? '待核对' : ended && item.status !== 'completed' ? '未完成' : STATUS_TEXT[item.status]}
            </span>
          </li>
        )
      })}
    </ol>
  </>
}

export function PlanBar({plan, runStatus, proposal = false, defaultOpen = false, className}: PlanBarProps) {
  const [expanded, setExpanded] = useState(defaultOpen)
  const [mounted, setMounted] = useState(defaultOpen)
  const [barHeight, setBarHeight] = useState<number>()
  const cardRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const contentId = useId()
  const hasPlan = !!plan?.items.length
  const setOpen = useCallback((open: boolean) => {
    clearTimeout(closeTimer.current)
    if (open) {
      setBarHeight(buttonRef.current ? buttonRef.current.getBoundingClientRect().height + 2 : undefined)
      setMounted(true)
    } else {
      closeTimer.current = setTimeout(() => setMounted(false), 240)
    }
    setExpanded(open)
  }, [])
  useEffect(() => () => clearTimeout(closeTimer.current), [])
  useEffect(() => {
    const button = buttonRef.current
    if (!button) return
    const observer = new ResizeObserver(() => setBarHeight(button.getBoundingClientRect().height + 2))
    observer.observe(button)
    return () => observer.disconnect()
  }, [hasPlan])
  useEffect(() => {
    if (!expanded) return
    const outside = (event: PointerEvent) => {
      if (!cardRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {setOpen(false); buttonRef.current?.focus()}
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [expanded, setOpen])
  if (!plan || (plan.items.length === 0 && plan.progressState !== 'unconfirmed')) return null
  const unconfirmed = plan.progressState === 'unconfirmed'
  const preparing = plan.progressState === 'preparing'
  const active = !proposal && !unconfirmed && !preparing && (runStatus === 'running' || runStatus === 'waiting')
  const ended = !proposal && runStatus != null && !['running', 'waiting'].includes(runStatus)
  const current = plan.currentIndex != null ? plan.items[plan.currentIndex] : null
  const total = plan.items.length
  const allDone = plan.completedCount === total
  const unfinished = total - plan.completedCount
  const progress = unconfirmed ? '进度未确认' : preparing ? '准备执行' : proposal ? `计划 ${total} 项`
    : allDone ? `计划 ${total}/${total} 项已完成`
      : ended ? `计划已完成 ${plan.completedCount}/${total} 项`
        : current ? `第 ${(plan.currentIndex ?? 0) + 1}/${total} 步` : '计划'
  const headline = unconfirmed ? '清单尚未核对，请以实际执行记录为准' : preparing ? `已承接 ${total} 项计划` : proposal ? '确认后按计划执行'
    : allDone ? ''
      : ended ? `${unfinished} 项未完成`
        : current ? current.text : `下一步：${plan.items.find(item => item.status === 'pending')?.text ?? '—'}`

  return (
    <div className={cn('relative animate-in fade-in-0 slide-in-from-bottom-1 duration-200 motion-reduce:animate-none', className)} style={mounted ? {height: barHeight} : undefined}>
      <div ref={cardRef} data-open={expanded} className={cn('plan-card overflow-hidden rounded-lg border bg-card text-card-foreground shadow-sm', mounted && 'absolute inset-x-0 bottom-0 z-50 shadow-lg')}>
        {mounted && <div id={contentId} role="region" aria-label="当前计划" aria-hidden={!expanded} inert={!expanded} className="plan-reveal">
          <div className="min-h-0 overflow-hidden">
            <div className="max-h-[min(28rem,60vh)] overflow-y-auto p-3">
              <PlanContent plan={plan} active={active} ended={ended}/>
            </div>
          </div>
        </div>}
      <button ref={buttonRef} type="button" aria-expanded={expanded} aria-controls={mounted ? contentId : undefined} onClick={() => setOpen(!expanded)}
        className="flex w-full items-center gap-3 px-3 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
        <span className="hidden items-center gap-0.5 sm:flex" aria-hidden>
          {plan.items.map(item => <span key={item.id} className={cn('h-1.5 w-3 rounded-[2px]', item.status === 'completed' ? 'bg-state-success' : item.status === 'in_progress' && active ? 'bg-signal' : 'bg-border')}/>)}
        </span>
        <span className="shrink-0 text-meta font-medium tabular-nums">{progress}</span>
        <span className={cn('min-w-0 flex-1 truncate text-meta', ended && !allDone ? 'text-state-waiting' : 'text-foreground')}>{headline}</span>
        <ChevronUp className={cn('size-4 shrink-0 text-muted-foreground transition-transform', expanded && 'rotate-180')} aria-hidden/>
        <span className="sr-only">{expanded ? '收起计划' : '展开计划'}</span>
      </button>
      </div>
    </div>
  )
}
