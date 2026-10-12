'use client'

import {useState} from 'react'
import {ChevronLeft, ChevronRight, ListTodo} from 'lucide-react'
import {Dialog, DialogContent, DialogTitle, DialogTrigger} from '@/components/ui/dialog'
import {Button} from '@/components/ui/button'
import {PlanContent} from './plan-bar'
import type {PlanHistoryEntry, RunView} from '@/lib/session-view'

/** 每次打开从最新清单开始；打开期间手选旧计划后保持选择。 */
export function PlanChecklist({plans, runs}: {plans: PlanHistoryEntry[]; runs: RunView[]}) {
  const [selectedId, setSelectedId] = useState<string | null>(plans.at(-1)?.id ?? null)
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
    {(plans.length > 1 || notice) && <div className="flex items-center gap-1">
      {plans.length > 1 && <>
        <Button variant="ghost" size="icon-xs" aria-label="上一份清单" disabled={index <= 0} onClick={() => setSelectedId(plans[index - 1].id)}><ChevronLeft className="size-4" aria-hidden/></Button>
        <span className="min-w-12 text-center text-xs tabular-nums text-muted-foreground" aria-live="polite" aria-label={`第 ${index + 1} 份，共 ${plans.length} 份`}>{index + 1} / {plans.length}</span>
        <Button variant="ghost" size="icon-xs" aria-label="下一份清单" disabled={index === plans.length - 1} onClick={() => setSelectedId(plans[index + 1].id)}><ChevronRight className="size-4" aria-hidden/></Button>
      </>}
      {notice && <span className="ml-auto text-xs text-muted-foreground">{notice}</span>}
    </div>}
    <div className="min-h-0 overflow-y-auto overscroll-contain">
      {plan ? <PlanContent plan={plan} active={active} ended={ended}/>
        : <p className="py-8 text-center text-sm text-muted-foreground">当前对话暂无计划清单</p>}
    </div>
  </>
}

export function PlanListDialog({plans, runs}: {plans: PlanHistoryEntry[]; runs: RunView[]}) {
  return <Dialog>
    <DialogTrigger asChild>
      <Button type="button" variant="ghost" size="icon-sm" aria-label="查看待办清单" className="shrink-0 text-muted-foreground"><ListTodo className="size-4" aria-hidden/></Button>
    </DialogTrigger>
    <DialogContent aria-describedby={undefined}
      className="flex max-h-[min(44rem,85dvh)] flex-col gap-4 p-6 sm:max-w-2xl">
      <DialogTitle className="pr-8 text-base font-medium">计划清单</DialogTitle>
      <PlanChecklist plans={plans} runs={runs}/>
    </DialogContent>
  </Dialog>
}
