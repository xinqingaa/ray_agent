import {useCallback, useEffect, useState} from 'react'
import {getHostPreferences, isDesktop, setHostPreferences, type HostPreferences, type HostPreferencesPatch} from '@/lib/platform'

export type HostPreferencesState = {
  /** 读取前为 null；非桌面环境为 null 且 available 为 false */
  preferences: HostPreferences | null
  available: boolean
  error: string | null
  update: (patch: HostPreferencesPatch) => Promise<void>
}

/** 宿主偏好（任务完成通知、退出前确认）。修改立即写回宿主，失败时保留原值并给出原因。 */
export function useHostPreferences(): HostPreferencesState {
  const available = isDesktop()
  const [preferences, setPreferences] = useState<HostPreferences | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!available) return
    let active = true
    getHostPreferences().then(
      value => {if (active) setPreferences(value)},
      reason => {if (active) setError(reason instanceof Error ? reason.message : '无法读取偏好')},
    )
    return () => {active = false}
  }, [available])

  const update = useCallback(async (patch: HostPreferencesPatch) => {
    try {
      setError(null)
      setPreferences(await setHostPreferences(patch))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法保存偏好')
    }
  }, [])

  return {preferences, available, error, update}
}
