import {cn} from '@/lib/utils'
import {describeWorkspace} from '@/lib/workspace-state'
import type {WorkspaceItem} from '@/lib/api/types'

const TONE = {
  可用: 'text-state-success',
  不可用: 'text-state-waiting',
  已归档: 'text-muted-foreground',
  正在删除: 'text-muted-foreground',
} as const

/** 状态用文字加色点表达，不只靠颜色。 */
export function WorkspaceStatus({workspace, className, compact = false}: {workspace: WorkspaceItem; className?: string; compact?: boolean}) {
  const {label} = describeWorkspace(workspace)
  if (compact) {
    if (label === '可用') return null
    const text = label === '不可用' && workspace.folder ? '找不到文件夹' : label
    return <span className={cn('shrink-0 rounded-full px-1.5 py-0.5 text-[11px]', TONE[label],
      label === '不可用' ? 'bg-state-waiting-soft' : 'bg-muted', className)}>{text}</span>
  }
  return <span className={cn('inline-flex shrink-0 items-center gap-1.5 text-xs', TONE[label], className)}>
    <span aria-hidden className="size-1.5 rounded-full bg-current"/>{label}
  </span>
}
