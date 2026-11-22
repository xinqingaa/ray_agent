import type {EntryVersion, RootEntry} from '@/lib/api/types'
import {leaseConflictText, leaseFromDetails} from '@/lib/workspace-changes'

/**
 * 文件夹里的条目操作（删除、重命名、新建文件夹）的纯逻辑：名称规则、版本、可用操作、编辑状态与失败文案。
 * 与核心的规则一致（核心仍是最终裁决）；不依赖组件，供文件树的行菜单、就地编辑与右键菜单（第 4 批）共用。
 */

/** 名称的 UTF-8 字节上限，与核心的单段名称规则一致；不是可调参数。 */
export const ENTRY_NAME_MAX_BYTES = 255

/** 核心保留的应用目录名，界面不允许用它新建或改名。 */
const RESERVED_NAME = '.rayagent'

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/

export type NameCheck = {ok: true; name: string; changed: boolean} | {ok: false; message: string}

/** 单段名称的界面检查：去掉首尾空白后判断；与核心规则相同，核心仍会再次校验。 */
export function entryNameError(raw: string): string | null {
  const name = raw.trim()
  if (!name || name === '.' || name === '..') return '名称不能为空，也不能是 . 或 ..'
  if (name.includes('/') || name.includes('\\')) return '名称不能包含 / 或 \\'
  if (CONTROL_CHARS.test(name)) return '名称不能包含控制字符'
  if (new TextEncoder().encode(name).length > ENTRY_NAME_MAX_BYTES) return '名称过长，最多 255 字节'
  if (name === RESERVED_NAME) return '该名称属于应用保留目录'
  return null
}

/** 新建文件夹的名称检查：任何通过规则的名称都会提交。 */
export function checkNewName(raw: string): NameCheck {
  const message = entryNameError(raw)
  return message ? {ok: false, message} : {ok: true, name: raw.trim(), changed: true}
}

/** 改名的名称检查：与原名相同视为无变化（不提交）。 */
export function checkRenameName(current: string, raw: string): NameCheck {
  const message = entryNameError(raw)
  if (message) return {ok: false, message}
  const name = raw.trim()
  return {ok: true, name, changed: name !== current}
}

/** 改名时默认选中的主名：扩展名（最后一个点之后）保留在选区之外，便于只改主名。 */
export function renameSelection(name: string): [number, number] {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? [0, dot] : [0, name.length]
}

/** 删除文件或改名需要的当前版本；文件夹没有版本，返回空。版本缺失（旧数据）时返回空，调用方应先刷新。 */
export function entryVersionOf(entry: RootEntry): EntryVersion | null {
  if (entry.kind !== 'file' || entry.size == null || entry.modified_ns == null) return null
  return {size: entry.size, modified_ns: entry.modified_ns}
}

/** 文件与文件夹各自能做的条目操作。改名只对普通文件；文件夹只能新建子文件夹与删除（空文件夹由核心裁决）。 */
export type EntryActions = {rename: boolean; remove: boolean; createFolder: boolean}

export function entryActionsFor(kind: RootEntry['kind']): EntryActions {
  return {
    rename: kind === 'file',
    remove: kind === 'file' || kind === 'directory',
    createFolder: kind === 'directory',
  }
}

/** 就地编辑的状态：改名针对一个条目，新建针对一个目录（根为空串）。`draft` 是输入框内容，`error` 是最近一次提交的说明。 */
export type EntryEdit =
  | {kind: 'rename'; path: string; entry: RootEntry; draft: string; error?: string}
  | {kind: 'create'; directory: string; draft: string; error?: string}

export function renameEdit(path: string, entry: RootEntry): EntryEdit {
  return {kind: 'rename', path, entry, draft: entry.name}
}

export function createEdit(directory: string): EntryEdit {
  return {kind: 'create', directory, draft: ''}
}

/** 操作失败的结构化信息，取自 ApiError（code、message、details）。 */
export type OperationFailure = {code: string; message: string; details?: Record<string, unknown> | null}

/**
 * 失败的说明文字：租约占用时说明占用者（同文件添加、撤销的文案），其他冲突显示核心原因，其余显示核心消息。
 * `titleOf` 读不到对话标题时只说“另一个对话”。
 */
export function entryFailureText(failure: OperationFailure, titleOf: (sessionId: string) => string | null): string {
  const lease = leaseFromDetails(failure.details)
  if (lease) return leaseConflictText(lease, titleOf(lease.owner_session_id))
  if (failure.code === 'conflict') return failure.message || '文件已被修改或同名已存在，请刷新后再试'
  return failure.message || '操作失败，请重试'
}
