import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

const WEEK_DAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** 把事件时间戳或日期字符串转成 Date。秒级时间戳会换成毫秒。没有有效时间则返回 null。 */
export function parseEventTime(value: unknown): Date | null {
  if (value == null || value === '') return null
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value < 1e12 ? value * 1000 : value
    const date = new Date(ms)
    return Number.isNaN(date.getTime()) ? null : date
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null
    if (/^\d+(\.\d+)?$/.test(trimmed)) {
      return parseEventTime(Number(trimmed))
    }
    // 接口里的 naive ISO 来自 UTC 容器，不能按浏览器本地时区解读
    const naiveIso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(trimmed)
    const date = new Date(naiveIso ? `${trimmed}Z` : trimmed)
    return Number.isNaN(date.getTime()) ? null : date
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value
  }
  return null
}

export function formatClockTime(value: unknown): string {
  const date = parseEventTime(value)
  if (!date) return ''
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
}

export function formatDayLabel(value: unknown): string {
  const date = parseEventTime(value)
  if (!date) return ''
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const diffDays = Math.floor((today.getTime() - target.getTime()) / (1000 * 60 * 60 * 24))

  if (diffDays === 0) return '今天'
  if (diffDays === 1) return '昨天'
  if (diffDays < 7 && diffDays > 1) return WEEK_DAYS[date.getDay()]

  return `${pad2(date.getMonth() + 1)}/${pad2(date.getDate())}`
}

/**
 * 会话列表用：保留日期语义，并带上已有的时分秒。
 * 没有有效时间时不编造“今天”。
 */
export function formatRelativeDate(dateStr: string | null | undefined): string {
  const clock = formatClockTime(dateStr)
  const day = formatDayLabel(dateStr)
  if (!clock) return day
  if (!day) return clock
  return `${day} ${clock}`
}

/** 由两个已有时间戳算出间隔，没有起止时间则不显示。 */
export function formatDurationBetween(start: unknown, end: unknown): string {
  const from = parseEventTime(start)
  const to = parseEventTime(end)
  if (!from || !to) return ''
  const sec = Math.round((to.getTime() - from.getTime()) / 1000)
  if (sec < 0) return ''
  if (sec < 60) return `${sec}秒`
  const minutes = Math.floor(sec / 60)
  const seconds = sec % 60
  if (minutes < 60) {
    return seconds ? `${minutes}分${pad2(seconds)}秒` : `${minutes}分`
  }
  const hours = Math.floor(minutes / 60)
  const remainMinutes = minutes % 60
  return remainMinutes ? `${hours}小时${remainMinutes}分` : `${hours}小时`
}

/**
 * 格式化文件大小
 * @param bytes 文件大小（字节）
 * @returns 格式化后的文件大小字符串，如 "2.52 MB"
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'

  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))

  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`
}

/** 用量展示用的 token 计数，不把缺失值显示成 0。 */
export function formatTokenCount(n: number): string {
  if (!Number.isFinite(n)) return '—'
  const abs = Math.abs(n)
  if (abs >= 1_000_000) {
    const value = n / 1_000_000
    return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)}M`
  }
  if (abs >= 10_000) {
    return `${(n / 1000).toFixed(1)}k`
  }
  return String(Math.round(n))
}
