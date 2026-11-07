import type {
  ChangeEntry, FileVersion, ForceCurrent, RunChanges, UndoItemRequest, UndoItemResult, WorkspaceChangeEvent, WriteLease,
} from '@/lib/api/types'

// ==================== 外部变更：合并与去抖 ====================

/** 一个去抖窗口内累计的变化：`refresh` 为真表示需要整体刷新，此时路径不再有意义。 */
export type ChangeBatch = {paths: string[]; refresh: boolean}

export const EMPTY_BATCH: ChangeBatch = {paths: [], refresh: false}

type ChangeInput = Pick<WorkspaceChangeEvent, 'kind' | 'paths' | 'refresh'>

/** 只有 changed 事件进入批次；路径去重并保持首次出现的顺序，整体刷新一旦出现就吞掉其余路径。 */
export function mergeChange(batch: ChangeBatch, event: ChangeInput): ChangeBatch {
  if (event.kind !== 'changed') return batch
  if (batch.refresh) return batch
  if (event.refresh) return {paths: [], refresh: true}
  const seen = new Set(batch.paths)
  const added = event.paths.filter(path => !seen.has(path) && seen.add(path))
  return added.length ? {paths: [...batch.paths, ...added], refresh: false} : batch
}

export function isEmptyBatch(batch: ChangeBatch): boolean {
  return !batch.refresh && batch.paths.length === 0
}

/** 相对路径的父目录；根下的条目为空串。 */
export function parentDirectory(path: string): string {
  const index = path.lastIndexOf('/')
  return index < 0 ? '' : path.slice(0, index)
}

/**
 * 需要重新列出的目录：`loaded` 是树里已读取的目录（根为空串）。整体刷新时全部重读，
 * 否则只读变化条目的父目录，且只限已经读取过的；没读过的目录展开时本来就会读到最新内容。
 */
export function directoriesToReload(batch: ChangeBatch, loaded: readonly string[]): string[] {
  if (batch.refresh) return [...loaded]
  const parents = new Set(batch.paths.map(parentDirectory))
  return loaded.filter(path => parents.has(path))
}

/** 正在预览的文件是否被明确报告变化（整体刷新时无法判断，不提示）。 */
export function touchesFile(batch: ChangeBatch, path: string): boolean {
  return !batch.refresh && batch.paths.includes(path)
}

export type ChangeCollector = {
  push: (event: ChangeInput) => void
  /** 立即交出已累计的批次（没有则不调用）；用于重连后要求整体刷新 */
  flushNow: () => void
  dispose: () => void
}

/**
 * 去抖收集器：窗口内的 changed 合并成一个批次，在最后一次事件之后 `delay` 毫秒交给 `flush`。
 * `schedule`/`cancel` 可注入以便不依赖真实时钟地检查。
 */
export function createChangeCollector(options: {
  delay: number
  flush: (batch: ChangeBatch) => void
  schedule?: (callback: () => void, delay: number) => unknown
  cancel?: (handle: unknown) => void
}): ChangeCollector {
  const schedule = options.schedule ?? ((callback, delay) => setTimeout(callback, delay))
  const cancel = options.cancel ?? (handle => clearTimeout(handle as ReturnType<typeof setTimeout>))
  let batch = EMPTY_BATCH
  let handle: unknown = null
  const emit = () => {
    if (handle != null) cancel(handle)
    handle = null
    const ready = batch
    batch = EMPTY_BATCH
    if (!isEmptyBatch(ready)) options.flush(ready)
  }
  return {
    push(event) {
      const next = mergeChange(batch, event)
      if (next === batch) return
      batch = next
      if (handle != null) cancel(handle)
      handle = schedule(emit, options.delay)
    },
    flushNow: emit,
    dispose() {
      if (handle != null) cancel(handle)
      handle = null
      batch = EMPTY_BATCH
    },
  }
}

// ==================== 写入租约 ====================

export type LeaseNotice =
  | {kind: 'writing'; own: boolean}
  | {kind: 'settling'; own: boolean}
  | {kind: 'blocked'; own: boolean}

/**
 * 工作区页要不要提示租约：自己的会话正常写入时不打扰；其他会话写入、正在停止、停止后未确认（任何人都可重试收尾）才提示。
 * `currentSessionId` 为空（工作区首页）时所有租约都算别人的。
 */
export function leaseNotice(lease: WriteLease | null | undefined, currentSessionId: string | null): LeaseNotice | null {
  if (!lease) return null
  const own = lease.owner_session_id !== '' && lease.owner_session_id === currentSessionId
  if (lease.state === 'blocked') return {kind: 'blocked', own}
  if (own) return null
  return lease.state === 'settling' ? {kind: 'settling', own} : {kind: 'writing', own}
}

/** 租约冲突（409）里的占用信息；其他错误返回 null。 */
export function leaseFromDetails(details: Record<string, unknown> | null | undefined): Pick<WriteLease, 'state' | 'owner_session_id' | 'writer_kind' | 'operation' | 'reason'> | null {
  const lease = details?.lease as Record<string, unknown> | undefined
  if (!lease || typeof lease !== 'object' || typeof lease.state !== 'string') return null
  return {
    state: lease.state as WriteLease['state'],
    owner_session_id: typeof lease.owner_session_id === 'string' ? lease.owner_session_id : '',
    writer_kind: lease.writer_kind as WriteLease['writer_kind'],
    operation: typeof lease.operation === 'string' ? lease.operation : null,
    reason: typeof lease.reason === 'string' ? lease.reason : '',
  }
}

// ==================== 撤销 ====================

export type UndoSelection = {selected: ReadonlySet<string>; forced: ReadonlySet<string>}

export const NO_SELECTION: UndoSelection = {selected: new Set(), forced: new Set()}

/** 已经是运行前状态的文件没有可撤销的内容。 */
export function isUndoable(entry: ChangeEntry): boolean {
  return entry.status !== 'restored'
}

/** 默认只选可直接撤销的；冲突项（运行之后又被改动）默认不选，需要明确仍要覆盖。 */
export function initialSelection(entries: readonly ChangeEntry[]): UndoSelection {
  return {selected: new Set(entries.filter(entry => entry.status === 'undoable').map(entry => entry.relative_path)), forced: new Set()}
}

/** 勾选或取消一项：冲突项只有允许仍要覆盖时才能勾选，勾选即带上 force。 */
export function setSelected(selection: UndoSelection, entry: ChangeEntry, on: boolean): UndoSelection {
  if (!isUndoable(entry)) return selection
  const selected = new Set(selection.selected)
  const forced = new Set(selection.forced)
  if (!on) {
    selected.delete(entry.relative_path)
    forced.delete(entry.relative_path)
  } else if (entry.status === 'conflict') {
    if (!entry.can_force) return selection
    selected.add(entry.relative_path)
    forced.add(entry.relative_path)
  } else selected.add(entry.relative_path)
  return {selected, forced}
}

/** 把界面看到的当前版本原样放进 force；文件不存在就是 `exists: false`。`modified_ns` 是十进制字符串，不得改成数字。 */
export function forceOf(current: FileVersion | null | undefined): ForceCurrent {
  return {exists: current != null, size: current?.size ?? null, modified_ns: current?.modified_ns ?? null}
}

/** 提交内容：按条目顺序，已选且仍可撤销的各一项；冲突项带上它当前的版本作为 force。 */
export function buildUndoItems(entries: readonly ChangeEntry[], selection: UndoSelection): UndoItemRequest[] {
  const items: UndoItemRequest[] = []
  for (const entry of entries) {
    if (!isUndoable(entry) || !selection.selected.has(entry.relative_path)) continue
    if (entry.status === 'conflict') {
      if (!entry.can_force || !selection.forced.has(entry.relative_path)) continue
      items.push({relative_path: entry.relative_path, force: forceOf(entry.current)})
    } else items.push({relative_path: entry.relative_path})
  }
  return items
}

/** 提交后仍冲突且允许仍要覆盖的项：用结果里返回的最新当前版本再次提交。 */
export function forceRetryItem(result: UndoItemResult): UndoItemRequest | null {
  if (result.status !== 'conflict' || !result.can_force) return null
  return {relative_path: result.relative_path, force: forceOf(result.current)}
}

/** 一次提交的结果合并进上次的结果：同一路径以最新为准，顺序保持首次出现。 */
export function mergeResults(previous: readonly UndoItemResult[], next: readonly UndoItemResult[]): UndoItemResult[] {
  const latest = new Map(next.map(result => [result.relative_path, result]))
  const merged = previous.map(result => latest.get(result.relative_path) ?? result)
  const known = new Set(previous.map(result => result.relative_path))
  return [...merged, ...next.filter(result => !known.has(result.relative_path))]
}

export type UndoSummary = {done: number; unchanged: number; conflicts: number; failed: number}

export function summarizeResults(results: readonly UndoItemResult[]): UndoSummary {
  const summary: UndoSummary = {done: 0, unchanged: 0, conflicts: 0, failed: 0}
  for (const result of results) {
    if (result.status === 'restored' || result.status === 'removed') summary.done++
    else if (result.status === 'unchanged') summary.unchanged++
    else if (result.status === 'conflict') summary.conflicts++
    else summary.failed++
  }
  return summary
}

/** 运行里有没有可以撤销（或需要处理冲突）的文件；运行仍在进行时没有入口。 */
export function undoAvailable(changes: Pick<RunChanges, 'run_active' | 'entries'> | null | undefined): boolean {
  return !!changes && !changes.run_active && changes.entries.some(isUndoable)
}

/** 运行状态里仍在进行的几种；这时文件还在变，没有撤销入口。 */
export function runStillActive(status: string): boolean {
  return status === 'running' || status === 'waiting'
}

// ==================== 租约占用的说明文字 ====================

type LeaseText = Pick<WriteLease, 'state' | 'owner_session_id'>

/** 写入被占用时给用户的说明（工作区页提示、添加文件与撤销被拒绝时显示）；读不到对话标题时只说“另一个对话”。 */
export function leaseConflictText(lease: LeaseText, title: string | null): string {
  const owned = lease.owner_session_id !== ''
  const holder = owned ? (title ? `对话「${title}」` : '另一个对话') : '文件夹的其他写入（如添加文件）'
  if (lease.state === 'blocked') return `${holder}停止后未能确认写入已结束，需要在工作区页点“重试收尾”后才能继续写入。`
  if (lease.state === 'settling') return `${holder}正在停止，尚未确认写入结束，请稍后再试。`
  return owned ? `${holder}正在写入这个文件夹，请等它结束后再试。` : '文件夹正在被写入（如添加文件），请稍后再试。'
}
