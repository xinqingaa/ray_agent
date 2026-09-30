import {ClipboardList, Folder, Layers, Paperclip, type LucideIcon} from 'lucide-react'
import type {RunStatus} from '@/lib/session-view'
import {matchesCommandQuery} from '@/lib/slash-trigger'

export type CommandAvailability =
  | {available: true}
  | {available: false; reason: string}

export type CommandHostActions = {
  /** 手动压缩；由会话页实现 */
  compact: () => void
}

/**
 * 输入框传给每条命令的页面状态。
 * 追加命令时可以扩展字段；菜单和 `/` 提示只把这份对象交给 `available` 与 `run`。
 */
export type CommandContext = {
  /** 是否已打开某个会话。首页为 false。 */
  hasSession: boolean
  /** 会话是否已有至少一次运行。首页为 false。 */
  hasRuns: boolean
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
  /** 正在手动压缩。 */
  compacting: boolean
  /** 输入框是否带计划模式标记。 */
  planMode: boolean
  /** PROJECT_ROOTS 已配置，项目功能启用。 */
  projectsEnabled: boolean
  /** 首页，或会话尚未开始首次运行时可绑定项目。 */
  projectBindable: boolean
  actions: CommandHostActions & {
    openFilePicker: () => void
    togglePlan: () => void
    openProjectPicker: () => void
  }
}

/** 页面能提供的部分。上传、计划标记与文件选择由输入框补上。 */
export type CommandHost = Omit<CommandContext, 'uploading' | 'planMode' | 'actions' | 'projectsEnabled' | 'projectBindable'> & {
  projectsEnabled?: boolean
  projectBindable?: boolean
  actions: CommandHostActions
}

export type InputCommand = {
  id: string
  surfaces: readonly ('plus' | 'slash')[]
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

function busy(context: CommandContext): CommandAvailability {
  if (context.submitting) return {available: false, reason: '正在发送或核对受理状态'}
  if (context.uploading) return {available: false, reason: '正在上传附件'}
  if (context.compacting) return {available: false, reason: '上下文正在压缩'}
  return {available: true}
}

function uploadAvailable(context: CommandContext): CommandAvailability {
  const state = busy(context)
  if (!state.available) return state
  if (context.uploading) return {available: false, reason: '正在上传'}
  if (context.waitingApproval) return {available: false, reason: '正在等待审批'}
  return {available: true}
}

const uploadCommand: InputCommand = {
  id: 'upload',
  surfaces: ['plus', 'slash'],
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

function planAvailable(context: CommandContext): CommandAvailability {
  const state = busy(context)
  if (!state.available) return state
  if (context.waitingApproval) return {available: false, reason: '正在等待审批'}
  if (context.runStatus === 'running') {
    return {available: false, reason: '运行进行中，计划模式只能在新运行开始时选择'}
  }
  if (context.runStatus === 'waiting') {
    if (context.waitingReply) return {available: false, reason: '正在等你回复提问'}
    return {available: false, reason: '正在等待审批'}
  }
  return {available: true}
}

const planCommand: InputCommand = {
  id: 'plan',
  surfaces: ['plus', 'slash'],
  title: '计划模式',
  description: '下一次发送以计划模式运行，只调研不写文件',
  keyword: 'plan',
  aliases: ['plan-mode'],
  keywords: ['计划'],
  icon: ClipboardList,
  available: planAvailable,
  run(context) {
    if (!planAvailable(context).available) return
    context.actions.togglePlan()
  },
}

function compactAvailable(context: CommandContext): CommandAvailability {
  const state = busy(context)
  if (!state.available) return state
  if (!context.hasSession || !context.hasRuns) {
    return {available: false, reason: '还没有可压缩的上下文'}
  }
  if (context.runStatus === 'running') {
    return {available: false, reason: '运行进行中，结束后才能压缩'}
  }
  if (context.runStatus === 'waiting') {
    return {available: false, reason: '正在等待回复，结束后才能压缩'}
  }
  if (context.compacting) return {available: false, reason: '正在压缩'}
  return {available: true}
}

function projectAvailable(): CommandAvailability {
  return {available: true}
}

const projectCommand: InputCommand = {
  id: 'project',
  surfaces: ['plus', 'slash'],
  title: '打开项目',
  description: '打开项目导航，保留当前草稿',
  keyword: 'project',
  aliases: [],
  keywords: ['项目', '目录', '仓库'],
  icon: Folder,
  available: projectAvailable,
  run(context) {
    if (!projectAvailable().available) return
    context.actions.openProjectPicker()
  },
}

const compactCommand: InputCommand = {
  id: 'compact',
  surfaces: ['plus', 'slash'],
  title: '压缩上下文',
  description: '摘要较早轮次，腾出上下文空间',
  keyword: 'compact',
  aliases: ['compress'],
  keywords: ['压缩', '上下文'],
  icon: Layers,
  available: compactAvailable,
  run(context) {
    if (!compactAvailable(context).available) return
    context.actions.compact()
  },
}

/** 按 id 查找命令，供上下文环等入口复用同一条注册项。 */
export function commandById(id: string): InputCommand | undefined {
  return inputCommands.find((command) => command.id === id)
}

/**
 * `+` 菜单与 `/` 提示只读这个数组，顺序即展示顺序。
 * 展示入口由 surfaces 定义，执行状态由 available 统一判断。
 */
export const inputCommands: readonly InputCommand[] = [uploadCommand, planCommand, compactCommand, projectCommand]

export function commandSearchFields(command: InputCommand): readonly string[] {
  return [command.keyword, ...command.aliases, ...command.keywords, command.title]
}

/** 按注册表顺序返回查询命中的命令。空查询返回全部。 */
export function matchingCommands(query: string, _context?: Pick<CommandContext, 'projectsEnabled'>, surface: 'plus' | 'slash' = 'slash'): readonly InputCommand[] {
  return inputCommands.filter((command) => {
    if (!command.surfaces.includes(surface)) return false
    return matchesCommandQuery(query, commandSearchFields(command))
  })
}
