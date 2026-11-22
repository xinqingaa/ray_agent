import {useEffect, useRef, useState} from 'react'
import {getHostPreferences, isDesktop, setHostPreferences, type HostPreferences, type HostPreferencesPatch} from '@/lib/platform'

type Key = keyof HostPreferences
export type HostPreferencesAccess = {
  available: () => boolean
  load: () => Promise<HostPreferences>
  save: (patch: HostPreferencesPatch) => Promise<HostPreferences>
}

const hostAccess = {available: isDesktop, load: getHostPreferences, save: setHostPreferences}
const writes = new WeakMap<HostPreferencesAccess, Promise<unknown>>()

export function useHostPreferences(access: HostPreferencesAccess = hostAccess) {
  const available = access.available()
  const [preferences, setPreferences] = useState<HostPreferences | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [errors, setErrors] = useState<Partial<Record<Key, string>>>({})
  const [pending, setPending] = useState<HostPreferencesPatch>({})
  const [attempt, setAttempt] = useState(0)
  const inFlight = useRef(new Set<Key>())

  useEffect(() => {
    if (!available) return
    let active = true
    void Promise.resolve(writes.get(access)).then(() => access.load()).then(
      value => {if (active) setPreferences(value)},
      reason => {if (active) setLoadError(reason instanceof Error ? reason.message : '无法读取偏好')},
    )
    return () => {active = false}
  }, [access, available, attempt])

  const reload = () => {
    setLoadError(null)
    setAttempt(count => count + 1)
  }
  const update = async (key: Key, checked: boolean) => {
    if (!preferences || inFlight.current.has(key)) return
    inFlight.current.add(key)
    setPending(values => ({...values, [key]: checked}))
    setErrors(errors => ({...errors, [key]: undefined}))
    // 宿主返回整份偏好，按写入顺序应用快照，避免一项的响应覆盖另一项。
    const request = Promise.resolve(writes.get(access)).then(() => access.save({[key]: checked}))
    writes.set(access, request.catch(() => {}))
    try {
      setPreferences(await request)
    } catch (reason) {
      setErrors(errors => ({...errors, [key]: reason instanceof Error ? reason.message : '无法保存偏好'}))
    } finally {
      inFlight.current.delete(key)
      setPending(values => ({...values, [key]: undefined}))
    }
  }
  return {preferences, available, loadError, errors, pending, reload, update}
}
