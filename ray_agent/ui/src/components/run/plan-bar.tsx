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

const STATUS_TEXT = {pending: '未开始', in_progress: '进行中', completed: '已完成', blocked: '受阻', cancelled: '已取消'}

function ItemIcon({item}: {item: PlanItem}) {
  if (item.status === 'completed') return <CircleCheck className="size-4 text-state-success" aria-hidden/>
  if (item.status === 'in_progress') return <CircleDot className="size-4 text-signal" aria-hidden/>
  return <Circle className={cn('size-4', item.status === 'blocked' ? 'text-state-waiting' : 'text-faint')} aria-hidden/>
}

export function planStages(plan: PlanView) { return plan.items.filter(item => item.kind !== 'step') }
function progressUnit(plan: PlanView) { return plan.items.some(item => item.kind === 'step') ? '阶段' : '项' }

export function PlanContent({plan, active, ended}: {plan: PlanView; active: boolean; ended: boolean}) {
  const stages = planStages(plan)
  const renderItem = (item: PlanItem, step: boolean) => <li key={item.id} className={cn('flex items-start gap-2 py-1.5', item.schedule === 'future' && 'opacity-60')}>
    <span className="pt-0.5"><ItemIcon item={item}/></span>
    <span className={cn('min-w-0 flex-1 text-meta break-words', (!step || active && item.status === 'in_progress') && 'font-medium', active && item.status === 'in_progress' && 'text-signal')}>{item.text}</span>
    <span className="shrink-0 pt-0.5 text-xs text-muted-foreground" title={item.status === 'blocked' || item.status === 'cancelled' ? item.reason : undefined}>{item.schedule === 'future' && item.status === 'pending' ? '后续' : ended && item.status === 'in_progress' ? '未完成' : !active && item.status === 'in_progress' ? '未完成' : STATUS_TEXT[item.status]}</span>
  </li>
  return <>
    <p className="text-meta font-medium break-words">{plan.title || '任务计划'}</p>
    {plan.description && <p className="mt-1 text-meta text-muted-foreground break-words">{plan.description}</p>}
    <ol className="mt-3 space-y-1">{stages.map(stage => {
      const children = plan.items.filter(s => s.kind === 'step' && s.parentId === stage.id)
      return <li key={stage.id}>
        <ol>{renderItem(stage, false)}</ol>
        {children.length > 0 && <div className="ml-2 border-l pl-4">
          <ol>{children.map(child => renderItem(child, true))}</ol>
        </div>}
      </li>
    })}</ol>
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
  if (!plan || plan.items.length === 0) return null
  const preparing = plan.progressState === 'preparing'
  const active = !proposal && !preparing && (runStatus === 'running' || runStatus === 'waiting')
  const ended = !proposal && runStatus != null && !['running', 'waiting'].includes(runStatus)
  const stages = planStages(plan)
  const total = stages.length
  const completed = stages.filter(s => s.status === 'completed').length
  const current = stages.find(s => s.status === 'in_progress')
  const blocked = stages.find(s => s.status === 'blocked')
  const focusedStage = blocked ?? current
  const children = focusedStage ? plan.items.filter(item => item.kind === 'step' && item.parentId === focusedStage.id) : []
  const currentStep = children.find(item => item.status === 'blocked') ?? children.find(item => item.status === 'in_progress')
  const showChildren = !preparing && !proposal && !!focusedStage && children.length > 0
  const remaining = stages.filter(s=>!['completed','cancelled'].includes(s.status))
  const missing = plan.artifacts?.some(a => a.required && a.schedule === 'current' && a.delivery === 'file' && a.state !== 'delivered')
  const allDone = remaining.length === 0 && !missing
  const progress = preparing ? '准备执行' : proposal ? `计划 ${total} ${progressUnit(plan)}`
    : allDone ? `已完成 ${completed}/${total} ${progressUnit(plan)}`
    : ended && missing ? '已交付部分成果'
    : blocked ? '任务受阻'
    : `已完成 ${completed}/${total} ${progressUnit(plan)}`
  const headline = preparing ? '正在承接已确认范围' : proposal ? '确认后按计划执行'
    : blocked ? blocked.text
    : current ? current.text : remaining.length ? `剩余 ${remaining.length} ${progressUnit(plan)}` : missing ? '仍有成果未交付' : ''

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
        <span className={cn('hidden items-center gap-0.5', !expanded && 'sm:flex')} aria-hidden>
          {stages.map(item => <span key={item.id} className={cn('h-1.5 w-3 rounded-[2px]', item.status === 'completed' ? 'bg-state-success' : item.status === 'in_progress' && active ? 'bg-signal' : item.schedule === 'future' ? 'bg-border/50' : 'bg-border')}/>)}
        </span>
        {expanded ? <span className="flex-1 text-meta font-medium">收起计划</span> : <>
        <span className="shrink-0 text-meta font-medium tabular-nums">{progress}</span>
        <span className="min-w-0 flex-1">
          <span className={cn('block truncate text-meta', ended && !allDone ? 'text-state-waiting' : 'text-foreground')}>{headline}</span>
          {showChildren && currentStep && <span className={cn('block truncate text-meta font-medium', active ? 'text-signal' : 'text-muted-foreground')}>{currentStep.text}</span>}
        </span>
        </>}
        <ChevronUp className={cn('size-4 shrink-0 text-muted-foreground transition-transform', expanded && 'rotate-180')} aria-hidden/>
        {!expanded && <span className="sr-only">展开计划</span>}
      </button>
      </div>
    </div>
  )
}
