import {formatTokenCount} from '@/lib/utils'
import type {TokenCounts} from '@/lib/session-view'

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** 走秒用：00:12、12:05、1:02:03 */
export function formatClock(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '--:--'
  const total = Math.floor(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${pad2(m)}:${pad2(s)}`
}

/** 工具与轮次耗时：3 ms、1.2 秒、2 分 05 秒 */
export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '—'
  if (ms < 1000) return `${Math.round(ms)} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} 秒`
  const total = Math.round(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  if (m < 60) return `${m} 分 ${pad2(s)} 秒`
  return `${Math.floor(m / 60)} 小时 ${pad2(m % 60)} 分`
}

export function formatTokens(n: number | null | undefined): string {
  if (n == null) return '—'
  return formatTokenCount(n)
}

export function totalTokens(t: TokenCounts | null | undefined): number | null {
  if (!t) return null
  if (t.total != null) return t.total
  if (t.prompt != null || t.completion != null) return (t.prompt ?? 0) + (t.completion ?? 0)
  return null
}

export function formatCount(n: number): string {
  return n.toLocaleString('zh-CN')
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return '大小未知'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let v = bytes / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v >= 10 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`
}

export function formatTime(ms: number | null | undefined): string {
  if (ms == null) return ''
  const d = new Date(ms)
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}
