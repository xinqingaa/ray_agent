/**
 * 把后端事件归一成前端的 `{ type, data }`。
 * 会话页渲染使用 session-projection.ts 的视图模型，不再在这里做时间线分组。
 *
 * 后端事件格式为 { event: "message"|"title"|..., data: {...} }，
 * 前端统一使用 { type, data }。
 */

import type {SSEEventData, SSEEventType} from '@/lib/api/types'

/** 后端返回的原始事件（可能用 event 或 type 表示类型） */
type RawEvent = {event?: string; type?: string; data?: unknown}

/**
 * 将后端单条事件转为前端 SSEEventData（统一 type + data）
 */
export function normalizeEvent(raw: RawEvent): SSEEventData | null {
  const type = (raw.type ?? raw.event) as SSEEventType | undefined
  const data = raw.data
  if (!type || data === undefined) return null
  return {type, data} as SSEEventData
}

/**
 * 将后端事件列表转为前端 SSEEventData[]
 */
export function normalizeEvents(rawList: unknown): SSEEventData[] {
  if (!Array.isArray(rawList)) return []
  const out: SSEEventData[] = []
  for (const raw of rawList) {
    const normalized = normalizeEvent(raw as RawEvent)
    if (normalized) out.push(normalized)
  }
  return out
}
