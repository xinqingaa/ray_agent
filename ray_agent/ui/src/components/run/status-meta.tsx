import {
  Ban,
  Bot,
  Check,
  CircleCheck,
  CircleDashed,
  CircleDot,
  CirclePause,
  CircleMinus,
  CircleStop,
  CircleX,
  FileText,
  Globe,
  Hourglass,
  ListChecks,
  type LucideIcon,
  Package,
  Plug,
  Search,
  ShieldQuestion,
  Sparkles,
  Square,
  SquareTerminal,
  Unplug,
  Wrench,
  X,
} from 'lucide-react'
import type {Activity, RunStatus, ToolCallStatus, ToolFamily} from '@/lib/session-view'

/** 状态色语义：每种状态固定一个颜色，文字类名与浅底类名成对使用 */
export type Tone = 'running' | 'waiting' | 'success' | 'failed' | 'stopped' | 'interrupted' | 'idle'

export const TONE_TEXT: Record<Tone, string> = {
  running: 'text-state-running',
  waiting: 'text-state-waiting',
  success: 'text-state-success',
  failed: 'text-state-failed',
  stopped: 'text-state-stopped',
  interrupted: 'text-state-interrupted',
  idle: 'text-muted-foreground',
}

export const TONE_SOFT: Record<Tone, string> = {
  running: 'bg-state-running-soft',
  waiting: 'bg-state-waiting-soft',
  success: 'bg-state-success-soft',
  failed: 'bg-state-failed-soft',
  stopped: 'bg-state-stopped-soft',
  interrupted: 'bg-state-interrupted-soft',
  idle: 'bg-muted',
}

export const TONE_BAR: Record<Tone, string> = {
  running: 'bg-state-running',
  waiting: 'bg-state-waiting',
  success: 'bg-state-success',
  failed: 'bg-state-failed',
  stopped: 'bg-state-stopped',
  interrupted: 'bg-state-interrupted',
  idle: 'bg-border',
}

export type RunPhase =
  | 'idle'
  | 'preparing_environment'
  | 'model'
  | 'tool'
  | 'waiting_reply'
  | 'waiting_approval'
  | 'stopping'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted'

export const RUN_PHASE: Record<RunPhase, {label: string; tone: Tone; icon: LucideIcon}> = {
  idle: {label: '空闲', tone: 'idle', icon: CircleDashed},
  preparing_environment: {label: '准备执行环境', tone: 'running', icon: Hourglass},
  model: {label: '模型思考中', tone: 'running', icon: Sparkles},
  tool: {label: '执行工具', tone: 'running', icon: CircleDot},
  waiting_reply: {label: '等你回复', tone: 'waiting', icon: CirclePause},
  waiting_approval: {label: '等待批准', tone: 'waiting', icon: ShieldQuestion},
  stopping: {label: '停止中', tone: 'stopped', icon: Hourglass},
  completed: {label: '已完成', tone: 'success', icon: CircleCheck},
  failed: {label: '失败', tone: 'failed', icon: CircleX},
  cancelled: {label: '已停止', tone: 'stopped', icon: CircleStop},
  interrupted: {label: '已中断', tone: 'interrupted', icon: Unplug},
}

export function runPhase(status: RunStatus | null | undefined, activity?: Activity | null): RunPhase {
  if (!status) return 'idle'
  if (status === 'running' || status === 'waiting') {
    const kind = activity?.kind
    if (kind === 'stopping') return 'stopping'
    if (kind === 'waiting_approval') return 'waiting_approval'
    if (kind === 'waiting_reply' || status === 'waiting') return 'waiting_reply'
    if (kind === 'preparing_environment') return 'preparing_environment'
    if (kind === 'tool') return 'tool'
    return 'model'
  }
  return status
}

export const TOOL_STATUS: Record<ToolCallStatus, {label: string; tone: Tone; icon: LucideIcon}> = {
  running: {label: '运行中', tone: 'running', icon: CircleDot},
  succeeded: {label: '成功', tone: 'success', icon: Check},
  failed: {label: '失败', tone: 'failed', icon: X},
  denied: {label: '被拒绝', tone: 'stopped', icon: Ban},
  skipped: {label: '未执行', tone: 'idle', icon: CircleMinus},
  cancelled: {label: '已取消', tone: 'stopped', icon: Square},
}

export const FAMILY: Record<ToolFamily, {label: string; icon: LucideIcon}> = {
  file: {label: '文件', icon: FileText},
  shell: {label: '终端', icon: SquareTerminal},
  browser: {label: '浏览器', icon: Globe},
  search: {label: '搜索', icon: Search},
  mcp: {label: 'MCP', icon: Plug},
  a2a: {label: '远程 Agent', icon: Bot},
  plan: {label: '计划', icon: ListChecks},
  deliver: {label: '交付', icon: Package},
  other: {label: '工具', icon: Wrench},
}
