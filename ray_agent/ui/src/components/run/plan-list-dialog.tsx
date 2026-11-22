import {ChevronLeft, ChevronRight, CircleX, CirclePause, ListChecks, X} from '@/components/ui/icons'
import {useState, type ReactNode} from 'react'
import {Dialog, DialogClose, DialogContent, DialogTitle, DialogTrigger} from '@/components/ui/dialog'
import {Button} from '@/components/ui/button'
import {PlanContent} from './plan-bar'
import type {PlanHistoryEntry, RunView} from '@/lib/session-view'

/** 每次打开从最新清单开始；打开期间手选旧计划后保持选择。 */
export function PlanChecklist({plans, runs, title, close, visible = true}: {
  plans: PlanHistoryEntry[]; runs: RunView[]; title?: ReactNode; close?: ReactNode; visible?: boolean
}) {
  const [selectedId, setSelectedId] = useState<string | null>(plans.at(-1)?.id ?? null)
  const [wasVisible, setWasVisible] = useState(visible)
  if (wasVisible !== visible) {
    setWasVisible(visible)
    if (visible) setSelectedId(plans.at(-1)?.id ?? null)
  }
  const selected = plans.find(plan => plan.id === selectedId) ?? plans.at(-1)
  if (selected && selectedId == null) setSelectedId(selected.id)
  const index = selected ? plans.indexOf(selected) : -1
  const plan = selected?.latest
  const run = runs.find(run => run.id === plan?.sourceRunId)
  const active = !!run && ['running', 'waiting'].includes(run.status) && selected === plans.at(-1)
    && plan?.progressState === 'confirmed'
  const notice = run?.status === 'cancelled' ? '已停止' : run?.status === 'failed' ? '执行失败'
    : run?.status === 'interrupted' ? '执行中断' : null

  const ended = !!run && !['running', 'waiting'].includes(run.status) && run.mode !== 'plan'

  return <>
    {(title || plans.length > 1) && <header className="flex shrink-0 items-center gap-2 border-b px-4 py-2.5 sm:px-5">
      {title}
      {plans.length > 1 && <div className="ml-auto flex shrink-0 items-center gap-0.5 rounded-lg bg-muted p-0.5" role="group" aria-label="切换清单">
        <Button type="button" variant="ghost" size="icon-xs" aria-label="上一份清单" disabled={index <= 0} onClick={() => setSelectedId(plans[index - 1].id)}><ChevronLeft className="size-4" aria-hidden/></Button>
        <span className="min-w-10 text-center text-xs tabular-nums text-muted-foreground" aria-live="polite" aria-label={`第 ${index + 1} 份，共 ${plans.length} 份`}>{index + 1} / {plans.length}</span>
        <Button type="button" variant="ghost" size="icon-xs" aria-label="下一份清单" disabled={index === plans.length - 1} onClick={() => setSelectedId(plans[index + 1].id)}><ChevronRight className="size-4" aria-hidden/></Button>
      </div>}
      {close}
    </header>}
    <div key={selected?.id} className="min-h-0 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">
      {plan ? <PlanContent plan={plan} active={active} ended={ended} status={notice && <span className={`inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs ${run?.status === 'failed' ? 'bg-state-failed-soft text-state-failed' : 'bg-muted text-muted-foreground'}`}>{run?.status === 'failed' ? <CircleX className="size-3.5" aria-hidden/> : <CirclePause className="size-3.5" aria-hidden/>}{notice}</span>}/>
        : <p className="py-8 text-center text-sm text-muted-foreground">当前对话暂无计划清单</p>}
    </div>
  </>
}

export function PlanListDialog({plans, runs, triggerLabel, open, onOpenChange, onRestoreFocus}: {
  plans: PlanHistoryEntry[]
  runs: RunView[]
  triggerLabel?: string
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onRestoreFocus?: () => void
}) {
  const [localOpen, setLocalOpen] = useState(false)
  const visible = open ?? localOpen
  return <Dialog open={visible} onOpenChange={onOpenChange ?? setLocalOpen}>
    {triggerLabel && <DialogTrigger asChild>
      <Button type="button" variant="outline" size="xs" className="shrink-0">{triggerLabel}</Button>
    </DialogTrigger>}
    <DialogContent aria-describedby={undefined} showCloseButton={false}
      onCloseAutoFocus={onRestoreFocus && (event => {event.preventDefault(); onRestoreFocus()})}
      className="flex max-h-[min(40rem,82dvh)] max-w-[min(36rem,calc(100vw-1.5rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(36rem,calc(100vw-1.5rem))]">
      <PlanChecklist plans={plans} runs={runs} visible={visible}
        title={<DialogTitle className="flex min-w-0 flex-1 items-center gap-2 text-meta">
          <span className="grid size-7 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground"><ListChecks className="size-4" aria-hidden/></span>
          <span className="truncate">{triggerLabel ? '计划清单' : '历史清单'}</span>
        </DialogTitle>}
        close={<DialogClose asChild><Button type="button" variant="ghost" size="icon-sm" aria-label="关闭" className="ml-auto shrink-0 text-muted-foreground"><X className="size-4" aria-hidden/></Button></DialogClose>}/>
    </DialogContent>
  </Dialog>
}
