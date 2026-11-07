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
export function WorkspaceStatus({workspace, className}: {workspace: WorkspaceItem; className?: string}) {
  const {label} = describeWorkspace(workspace)
  return <span className={cn('inline-flex shrink-0 items-center gap-1.5 text-xs', TONE[label], className)}>
    <span aria-hidden className="size-1.5 rounded-full bg-current"/>{label}
  </span>
}
