import {useEffect, useSyncExternalStore} from 'react'
import {usageApi, type UsagePreferences} from '@/lib/api/usage'

type Snapshot = {value: UsagePreferences | null; error: string | null}
let current: Snapshot = {value: null, error: null}
let pending: Promise<void> | null = null
let revision = 0
const listeners = new Set<() => void>()

function publish(value: UsagePreferences | null, error: string | null) {
  current = {value, error}
  listeners.forEach(listener => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {listeners.delete(listener)}
}

export function reloadUsagePreferences() {
  if (pending) return pending
  const generation = revision
  pending = usageApi.preferences()
    .then(value => {if (generation === revision) publish(value, null)})
    .catch(error => {if (generation === revision) publish(current.value, error instanceof Error ? error.message : '读取偏好失败')})
    .finally(() => {pending = null})
  return pending
}

export async function setUsagePreferences(fields: Partial<UsagePreferences>) {
  // 每个更新响应只有在它仍是最新调用时才覆盖本地视图；保存后读回可汇合其他分区的更新。
  const generation = ++revision
  try {
    const value = await usageApi.setPreferences(fields)
    if (generation === revision) publish(value, null)
    return value
  } finally {
    if (pending) await pending
    await reloadUsagePreferences()
  }
}

export function useUsagePreferences() {
  const snapshot = useSyncExternalStore(subscribe, () => current, () => current)
  useEffect(() => {
    if (current.value == null) void reloadUsagePreferences()
  }, [])
  return snapshot
}
