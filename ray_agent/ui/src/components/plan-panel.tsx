'use client'

import { cn } from '@/lib/utils'
import { useState } from 'react'
import { Check, ChevronDown, ChevronUp, CircleAlert, CircleDot, Clock } from 'lucide-react'
import type { PlanStep } from '@/lib/api/types'

export interface PlanPanelProps {
  className?: string
  /** 计划步骤列表（来自事件列表中最新的 plan 事件） */
  steps?: PlanStep[]
}

function StepIcon({ status }: { status: PlanStep['status'] }) {
  if (status === 'completed') return <Check size={16} className="relative top-0.5 flex-shrink-0" />
  if (status === 'failed') return <CircleAlert size={16} className="relative top-0.5 flex-shrink-0 text-destructive" />
  if (status === 'running') return <CircleDot size={16} className="relative top-0.5 flex-shrink-0 text-foreground" />
  return <Clock size={16} className="relative top-0.5 flex-shrink-0" />
}

export function PlanPanel({ className, steps: stepsProp = [] }: PlanPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const togglePanel = () => setIsExpanded(!isExpanded)
  const steps = stepsProp

  if (steps.length === 0) return null

  const completedCount = steps.filter((s) => s.status === 'completed').length
  const failedCount = steps.filter((s) => s.status === 'failed').length
  const interrupted = failedCount > 0
  const totalCount = steps.length
  const progressLabel = interrupted
    ? `已中断 ${completedCount} / ${totalCount}`
    : `${completedCount} / ${totalCount}`
  // 折叠时显示进行中的一项；没有进行中时显示下一项待办，全部完成时显示最后一项
  const currentStep =
    steps.find((s) => s.status === 'running') ??
    steps.find((s) => s.status === 'pending') ??
    steps[steps.length - 1]

  return (
    <div className={cn('bg-card rounded-xl border', className)}>
      {/* 折叠状态 */}
      {!isExpanded && <div
        className="flex flex-row items-start justify-between pr-3 relative clickable cursor-pointer rounded-xl"
        onClick={togglePanel}
      >
        {/* 左侧的当前步骤 */}
        <div className="flex-1 min-w-0 relative overflow-hidden">
          <div className="w-full h-9">
            <div className="flex items-center justify-center gap-2.5 w-full px-4 py-2 truncate text-muted-foreground">
              <StepIcon status={currentStep.status} />
              <div className="flex flex-col w-full gap-0.5 truncate">
                <div className={cn('text-sm truncate', currentStep.status === 'running' && 'text-foreground')}>
                  {currentStep.description || '暂无步骤'}
                </div>
              </div>
            </div>
          </div>
        </div>
        {/* 右侧操作按钮&步骤信息 */}
        <div className="flex h-full justify-center gap-2 flex-shrink-0 items-center py-2.5">
          <span className={cn('text-xs', interrupted ? 'text-destructive' : 'text-muted-foreground')}>
            {progressLabel}
          </span>
          <ChevronUp className="text-foreground" size={16} />
        </div>
      </div>}
      {/* 展开状态：标题、进度、箭头同一行 */}
      {isExpanded && (
        <div className="flex flex-col rounded-xl">
          <div
            className="flex items-center justify-between px-4 py-2.5 cursor-pointer"
            onClick={togglePanel}
          >
            <span className="text-foreground font-bold">任务进度</span>
            <div className="flex items-center gap-2">
              <span className={cn('text-xs', interrupted ? 'text-destructive' : 'text-muted-foreground')}>
                {progressLabel}
              </span>
              <ChevronDown className="text-foreground" size={16} />
            </div>
          </div>
          <div className="px-4 pb-4">
            <div className="bg-muted/50 rounded-lg px-2 py-3">
              <div className="max-h-[min(calc(100vh-360px),400px)] overflow-y-auto">
                {steps.map((step) => (
                <div
                  key={step.id}
                  className={cn(
                    'flex items-center text-sm gap-2.5 w-full px-4 py-2 truncate',
                    step.status === 'running' ? 'text-foreground' : 'text-muted-foreground',
                  )}
                >
                  <StepIcon status={step.status} />
                  <div className="flex flex-col w-full truncate">
                    <div className="text-sm truncate">{step.description}</div>
                  </div>
                </div>
              ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
