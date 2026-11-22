import type {ReactNode} from 'react'
import {useEffect, useId, useRef, useState} from 'react'
import {ArrowRight, ChevronUp, Circle, CircleCheck, CircleDot, History, Loader2} from '@/components/ui/icons'
import {Button} from '@/components/ui/button'
import {IconAction} from '@/components/ui/icon-action'
import {cn} from '@/lib/utils'
import type {PlanItem, PlanView, RunStatus} from '@/lib/session-view'

type PlanBarProps = {
  plan: PlanView | null
  runStatus?: RunStatus | null
  /** 计划模式结束后等待确认执行的清单：不显示进度，只列出步骤 */
  proposal?: boolean
  defaultOpen?: boolean
  onOpenHistory?: (returnFocus: HTMLButtonElement | null) => void
  execute?: {onClick: () => void; disabled?: boolean}
  className?: string
}

const STATUS_TEXT = {pending: '未开始', in_progress: '进行中', completed: '已完成', blocked: '受阻', cancelled: '已取消'}

/** spinning 只给最深一层的进行中项；子步骤在进行时，阶段本身保持静态。 */
function ItemIcon({item, spinning}: {item: PlanItem; spinning: boolean}) {
  if (item.status === 'completed') return <CircleCheck className="size-4 text-state-success" aria-hidden/>
  if (item.status === 'in_progress') return spinning
    ? <Loader2 className="size-4 animate-spin text-muted-foreground motion-reduce:animate-none" aria-hidden/>
    : <CircleDot className="size-4 text-muted-foreground" aria-hidden/>
  return <Circle className={cn('size-4', item.status === 'blocked' ? 'text-state-waiting' : 'text-faint')} aria-hidden/>
}

export function planStages(plan: PlanView) { return plan.items.filter(item => item.kind !== 'step') }
function progressUnit(plan: PlanView) { return plan.items.some(item => item.kind === 'step') ? '阶段' : '项' }

/** 一条轨道，填充长度只表示已完成比例，不随进行中改色。 */
function StageTrack({completed, total}: {completed: number; total: number}) {
  const ratio = total > 0 ? Math.min(100, Math.max(0, (completed / total) * 100)) : 0
  return (
    <span className="relative hidden h-1 w-14 shrink-0 overflow-hidden rounded-full bg-border sm:inline-block" aria-hidden>
      <span className="absolute inset-y-0 left-0 rounded-full bg-foreground/70" style={{width: `${ratio}%`}}/>
    </span>
  )
}

export function PlanContent({plan, active, ended, status, actions}: {
  plan: PlanView; active: boolean; ended: boolean; status?: ReactNode; actions?: ReactNode
}) {
  const stages = planStages(plan)
  const renderRow = (item: PlanItem, step: boolean, spinning = active) => {
    const current = active && item.status === 'in_progress'
    const label = item.schedule === 'future' && item.status === 'pending' ? '后续'
      : (ended || !active) && item.status === 'in_progress' ? '未完成' : STATUS_TEXT[item.status]
    return <div className={cn('flex min-h-8 items-start gap-2.5 rounded-lg px-2 py-1.5', current && 'bg-signal-soft/55',
      item.schedule === 'future' && 'text-muted-foreground')}>
      <span className="mt-0.5 grid size-4 shrink-0 place-items-center"><ItemIcon item={item} spinning={spinning}/></span>
      <span className={cn('min-w-0 flex-1 break-words', step ? 'text-meta' : 'text-sm font-medium', current && 'font-medium')}>{item.text}</span>
      <span className={cn('shrink-0 self-start pt-0.5 text-xs', current ? 'text-signal' : 'text-muted-foreground')}
        title={item.status === 'blocked' || item.status === 'cancelled' ? item.reason : undefined}>{label}</span>
    </div>
  }

  return <>
    <div className="flex items-start gap-2.5">
      <div className="min-w-0 flex-1">
        <h3 className="break-words text-base font-semibold leading-snug">{plan.title || '任务计划'}</h3>
        {plan.description && <p className="mt-1 break-words text-meta leading-relaxed text-muted-foreground">{plan.description}</p>}
      </div>
      {status}
      {actions}
    </div>
    <ol className="mt-3 space-y-1">
      {stages.map(stage => {
        const children = plan.items.filter(item => item.kind === 'step' && item.parentId === stage.id)
        return <li key={stage.id}>
          {renderRow(stage, false, active && !children.some(child => child.status === 'in_progress'))}
          {children.length > 0 && <ol className="mt-0.5 ml-4 space-y-0.5 border-l pl-2.5">
            {children.map(child => <li key={child.id}>{renderRow(child, true)}</li>)}
          </ol>}
        </li>
      })}
    </ol>
  </>
}

export function PlanBar({plan, runStatus, proposal = false, defaultOpen = false, onOpenHistory, execute, className}: PlanBarProps) {
  const [expanded, setExpanded] = useState(defaultOpen)
  const cardRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const contentId = useId()
  useEffect(() => {
    if (!expanded) return
    const outside = (event: PointerEvent) => {
      if (!cardRef.current?.contains(event.target as Node)) setExpanded(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      setExpanded(false)
      buttonRef.current?.focus({preventScroll: true})
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [expanded])
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
  const headline = preparing ? '正在承接已确认范围' : proposal ? '待确认'
    : blocked ? blocked.text
    : current ? current.text : remaining.length ? `剩余 ${remaining.length} ${progressUnit(plan)}` : missing ? '仍有成果未交付' : ''

  return (
    <div ref={cardRef} data-open={expanded} className={cn('plan-card relative', className)}>
      <div className={cn('flex min-w-0 items-center gap-1 rounded-xl bg-muted/75 p-1', expanded && 'bg-muted')}>
        <button ref={buttonRef} type="button" aria-expanded={expanded} aria-controls={contentId} onClick={() => setExpanded(!expanded)}
          className="flex min-h-8 min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 text-left outline-none hover:bg-background/70 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
          <span className="shrink-0 whitespace-nowrap text-meta font-medium tabular-nums">{progress}</span>
          {!proposal && <StageTrack completed={completed} total={total}/>}
          <span className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden" title={[headline, showChildren && currentStep?.text].filter(Boolean).join(' › ')}>
            <span className={cn('truncate text-meta', showChildren && currentStep && 'max-w-[45%]', ended && !allDone ? 'text-state-waiting' : 'text-muted-foreground')}>{headline}</span>
            {showChildren && currentStep && <><span className="shrink-0 text-faint" aria-hidden>›</span><span className="min-w-0 flex-1 truncate text-meta font-medium">{currentStep.text}</span></>}
          </span>
          <ChevronUp className={cn('size-4 shrink-0 text-muted-foreground transition-transform duration-(--motion-fast) motion-reduce:transition-none', expanded && 'rotate-180')} aria-hidden/>
          <span className="sr-only">{expanded ? '收起计划' : '展开计划'}</span>
        </button>
        {execute && <Button type="button" size="sm" className="h-8 shrink-0 rounded-lg px-2.5" {...execute}>
          <span>按计划执行</span><ArrowRight className="hidden size-3.5 sm:block" aria-hidden/>
        </Button>}
      </div>
      <div id={contentId} role="region" aria-label="当前计划" aria-hidden={!expanded} inert={!expanded}
        className="plan-reveal absolute inset-x-0 bottom-[calc(100%+6px)] z-50 max-h-[min(27.5rem,56dvh)] overflow-y-auto overscroll-contain rounded-[18px] bg-popover px-4 py-3.5 text-popover-foreground shadow-(--float-shadow) [scrollbar-width:thin]">
        <PlanContent plan={plan} active={active} ended={ended}
          actions={onOpenHistory && <IconAction label="历史清单" className="-mt-1 -mr-1 shrink-0 text-muted-foreground"
            onClick={() => {
              setExpanded(false)
              onOpenHistory(buttonRef.current)
            }}><History aria-hidden/></IconAction>}/>
      </div>
    </div>
  )
}
