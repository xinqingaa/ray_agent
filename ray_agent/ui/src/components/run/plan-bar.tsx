'use client'

import {useId, useState} from 'react'
import {ChevronUp, Circle, CircleCheck, CircleDot} from 'lucide-react'
import {cn} from '@/lib/utils'
import type {PlanChange, PlanItem, PlanView, RunStatus} from '@/lib/session-view'
import {useNow} from './clock'
import {formatClock, formatDuration} from './format'

type PlanBarProps = {
  plan: PlanView | null
  /** 计划所属运行的状态，用于判断“运行结束时有未完成项” */
  runStatus?: RunStatus | null
  defaultExpanded?: boolean
  className?: string
}

const CHANGE_LABEL: Record<PlanChange['kind'], string> = {
  added: '新增',
  removed: '已删除',
  status: '状态变化',
}

function statusChangeLabel(change: PlanChange): string {
  if (change.kind !== 'status') return CHANGE_LABEL[change.kind]
  if (change.to === 'completed') return '刚完成'
  if (change.to === 'in_progress') return '开始'
  return '重新打开'
}

function ItemIcon({item, ended}: {item: PlanItem; ended: boolean}) {
  if (item.status === 'completed') return <CircleCheck className="size-4 text-state-success" aria-hidden/>
  if (item.status === 'in_progress' && !ended) return <CircleDot className="size-4 text-signal" aria-hidden/>
  return <Circle className={cn('size-4', ended ? 'text-state-waiting' : 'text-faint')} aria-hidden/>
}

function Segments({items, ended}: {items: PlanItem[]; ended: boolean}) {
  return (
    <span className="flex items-center gap-0.5" aria-hidden>
      {items.map((item, i) => (
        <span
          key={i}
          className={cn(
            'h-1.5 w-3 rounded-[2px] sm:w-4',
            item.status === 'completed'
              ? 'bg-state-success'
              : item.status === 'in_progress' && !ended
                ? 'bg-signal'
                : ended
                  ? 'bg-state-waiting/40'
                  : 'bg-border',
          )}
        />
      ))}
    </span>
  )
}

/**
 * 计划条：折叠时显示进度、当前项与其用时；展开为完整清单与说明，本次更新变化的项带标记。
 * 没有计划时不占位。
 */
export function PlanBar({plan, runStatus, defaultExpanded = false, className}: PlanBarProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const listId = useId()
  const active = runStatus === 'running' || runStatus === 'waiting'
  const current = plan && plan.currentIndex != null ? plan.items[plan.currentIndex] : null
  const now = useNow(active && current?.startedAt != null)

  if (!plan || plan.items.length === 0) return null

  const total = plan.items.length
  const allDone = plan.completedCount === total
  const ended = !active && runStatus != null
  const unfinished = total - plan.completedCount
  const endedUnfinished = ended && unfinished > 0
  const changedByIndex = new Map(plan.changed.filter((c) => c.kind !== 'removed').map((c) => [c.index, c]))
  const removed = plan.changed.filter((c) => c.kind === 'removed')
  const showChanged = plan.version > 1 && plan.changed.length > 0

  let headline: string
  if (allDone) headline = '全部完成'
  else if (endedUnfinished) headline = `运行结束时 ${unfinished} 项未完成`
  else if (current) headline = current.text
  else headline = `下一项：${plan.items.find((i) => i.status === 'pending')?.text ?? '—'}`

  const currentElapsed = current?.startedAt != null && now != null && !ended ? now - current.startedAt : null

  return (
    <section aria-label="计划" className={cn('rounded-lg border bg-card', className)}>
      {expanded && (
        <div id={listId} className="border-b px-3 pt-3 pb-2">
          {plan.explanation && (
            <p className="mb-2 text-meta text-muted-foreground">{plan.explanation}</p>
          )}
          <ol className="space-y-0.5">
            {plan.items.map((item, i) => {
              const change = changedByIndex.get(i)
              const isCurrent = i === plan.currentIndex && !ended
              const took = item.startedAt != null && item.completedAt != null ? item.completedAt - item.startedAt : null
              return (
                <li
                  key={`${i}-${item.text}`}
                  className={cn(
                    'relative flex items-start gap-2 rounded-md py-1 pr-1 pl-2',
                    showChanged && change && 'bg-signal-soft/60',
                  )}
                >
                  {showChanged && change && <span className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-signal" aria-hidden/>}
                  <span className="w-4 shrink-0 pt-px text-right text-xs tabular-nums text-faint">{i + 1}</span>
                  <span className="pt-0.5"><ItemIcon item={item} ended={ended}/></span>
                  <span
                    className={cn(
                      'min-w-0 flex-1 text-meta',
                      item.status === 'completed' ? 'text-muted-foreground' : 'text-foreground',
                      isCurrent && 'font-medium',
                    )}
                  >
                    {item.text}
                    {ended && item.status !== 'completed' && (
                      <span className="ml-2 text-xs text-state-waiting">未完成</span>
                    )}
                  </span>
                  {showChanged && change && (
                    <span className="shrink-0 rounded-sm px-1.5 text-xs text-signal">{statusChangeLabel(change)}</span>
                  )}
                  <span className="w-16 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                    {isCurrent && currentElapsed != null ? formatClock(currentElapsed) : took != null ? formatDuration(took) : ''}
                  </span>
                </li>
              )
            })}
            {showChanged && removed.map((c) => (
              <li key={`removed-${c.index}-${c.text}`} className="flex items-start gap-2 py-1 pr-1 pl-2">
                <span className="w-4 shrink-0"/>
                <span className="pt-0.5"><Circle className="size-4 text-faint" aria-hidden/></span>
                <span className="min-w-0 flex-1 text-meta text-faint line-through">{c.text}</span>
                <span className="shrink-0 px-1.5 text-xs text-muted-foreground">已删除</span>
                <span className="w-16 shrink-0"/>
              </li>
            ))}
          </ol>
        </div>
      )}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-controls={expanded ? listId : undefined}
        className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Segments items={plan.items} ended={ended}/>
        <span className="text-meta font-medium tabular-nums">
          {plan.completedCount}<span className="text-muted-foreground font-normal">/{total}</span>
        </span>
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-meta',
            endedUnfinished ? 'text-state-waiting' : allDone ? 'text-muted-foreground' : 'text-foreground',
          )}
        >
          {headline}
        </span>
        {showChanged && (
          <span className="shrink-0 rounded-sm bg-signal-soft px-1.5 py-0.5 text-xs text-signal max-sm:hidden">
            计划已更新 {plan.changed.length} 项
          </span>
        )}
        {currentElapsed != null && (
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{formatClock(currentElapsed)}</span>
        )}
        <ChevronUp
          className={cn('size-4 shrink-0 text-muted-foreground transition-transform', expanded && 'rotate-180')}
          aria-hidden
        />
        <span className="sr-only">{expanded ? '收起计划' : '展开计划'}</span>
      </button>
    </section>
  )
}
