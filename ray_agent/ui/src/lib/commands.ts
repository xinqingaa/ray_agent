import {Paperclip, type LucideIcon} from 'lucide-react'
import type {RunStatus} from '@/lib/session-view'
import {matchesCommandQuery} from '@/lib/slash-trigger'

export type CommandAvailability =
  | {available: true}
  | {available: false; reason: string}

/**
 * 输入框传给每条命令的页面状态。
 * 追加命令时可以扩展字段；菜单和 `/` 提示只把这份对象交给 `available` 与 `run`。
 */
export type CommandContext = {
  /** 是否已打开某个会话。首页为 false。 */
  hasSession: boolean
  /** 最新运行状态。没有运行，或在首页时，为 idle。 */
  runStatus: RunStatus | 'idle'
  /** 活动运行正在等待审批。 */
  waitingApproval: boolean
  /** 活动运行正在等待提问回复。 */
  waitingReply: boolean
  /** 正在提交消息。 */
  submitting: boolean
  /** 正在上传附件。 */
  uploading: boolean
  actions: {
    openFilePicker: () => void
  }
}

/** 页面能提供的部分。上传中与文件选择由输入框补上。 */
export type CommandHost = Omit<CommandContext, 'uploading' | 'actions'>

export type InputCommand = {
  id: string
  title: string
  description: string
  /** `/` 后的主关键字，不含斜杠。 */
  keyword: string
  aliases: readonly string[]
  /** 额外搜索词。匹配时与关键字、别名、标题一起比较。 */
  keywords: readonly string[]
  icon: LucideIcon
  available: (context: CommandContext) => CommandAvailability
  run: (context: CommandContext) => void
}

function uploadAvailable(context: CommandContext): CommandAvailability {
  if (context.uploading) return {available: false, reason: '正在上传'}
  if (context.waitingApproval) return {available: false, reason: '正在等待审批'}
  return {available: true}
}

const uploadCommand: InputCommand = {
  id: 'upload',
  title: '上传附件',
  description: '选择文件，附在下一条消息上',
  keyword: 'upload',
  aliases: ['attach'],
  keywords: ['文件', '附件'],
  icon: Paperclip,
  available: uploadAvailable,
  run(context) {
    if (!uploadAvailable(context).available) return
    context.actions.openFilePicker()
  },
}

/**
 * `+` 菜单与 `/` 提示只读这个数组，顺序即展示顺序。
 * 追加 Plan、压缩上下文或选择项目时在这里加一项，不要改菜单组件。
 */
export const inputCommands: readonly InputCommand[] = [uploadCommand]

export function commandSearchFields(command: InputCommand): readonly string[] {
  return [command.keyword, ...command.aliases, ...command.keywords, command.title]
}

/** 按注册表顺序返回查询命中的命令。空查询返回全部。 */
export function matchingCommands(query: string): readonly InputCommand[] {
  return inputCommands.filter((command) => matchesCommandQuery(query, commandSearchFields(command)))
}
