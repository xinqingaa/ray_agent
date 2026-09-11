'use client'

import { cn } from '@/lib/utils'
import { useState } from 'react'
import { Check, ChevronDown, ChevronUp, CircleAlert, Clock } from 'lucide-react'
import type { PlanStep } from '@/lib/api/types'

export interface PlanPanelProps {
  className?: string
  /** 计划步骤列表（来自事件列表中的 plan 事件） */
  steps?: PlanStep[]
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

  return (
    <div className={cn('bg-white rounded-xl border', className)}>
      {/* 折叠状态 */}
      {!isExpanded && <div
        className="flex flex-row items-start justify-between pr-3 relative clickable cursor-pointer rounded-xl"
        onClick={togglePanel}
      >
        {/* 左侧的最新计划 */}
        <div className="flex-1 min-w-0 relative overflow-hidden">
          <div className="w-full h-9">
            <div className="flex items-center justify-center gap-2.5 w-full px-4 py-2 truncate text-gray-500">
              <Clock size={16} />
              <div className="flex flex-col w-full gap-0.5 truncate">
                <div className="text-sm truncate">
                  {steps[0]?.description ?? '暂无步骤'}
                </div>
              </div>
            </div>
          </div>
        </div>
        {/* 右侧操作按钮&步骤信息 */}
        <div className="flex h-full justify-center gap-2 flex-shrink-0 items-center py-2.5">
          <span className={cn('text-xs', interrupted ? 'text-red-600' : 'text-gray-500')}>
            {progressLabel}
          </span>
          <ChevronUp className="text-gray-700" size={16} />
        </div>
      </div>}
      {/* 展开状态：标题、进度、箭头同一行 */}
      {isExpanded && (
        <div className="flex flex-col rounded-xl">
          <div
            className="flex items-center justify-between px-4 py-2.5 cursor-pointer"
            onClick={togglePanel}
          >
            <span className="text-gray-700 font-bold">任务进度</span>
            <div className="flex items-center gap-2">
              <span className={cn('text-xs', interrupted ? 'text-red-600' : 'text-gray-500')}>
                {progressLabel}
              </span>
              <ChevronDown className="text-gray-700" size={16} />
            </div>
          </div>
          <div className="px-4 pb-4">
            <div className="bg-gray-50 rounded-lg px-2 py-3">
              <div className="max-h-[min(calc(100vh-360px),400px)] overflow-y-auto">
                {steps.map((step) => (
                <div
                  key={step.id}
                  className="flex items-center text-gray-500 text-sm gap-2.5 w-full px-4 py-2 truncate"
                >
                  {step.status === 'completed' ? (
                    <Check size={16} className="relative top-0.5 flex-shrink-0" />
                  ) : step.status === 'failed' ? (
                    <CircleAlert size={16} className="relative top-0.5 flex-shrink-0 text-red-600" />
                  ) : (
                    <Clock size={16} className="relative top-0.5 flex-shrink-0" />
                  )}
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