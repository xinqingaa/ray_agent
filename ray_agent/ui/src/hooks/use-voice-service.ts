import {useEffect, useState} from 'react'
import {isOfficialDeepSeek, MODEL_CONNECTIONS_CHANGED, modelConnectionsApi} from '@/lib/api/model-connections'

export type VoiceServiceStatus =
  | {phase: 'loading' | 'ready' | 'unconfigured'}
  | {phase: 'error'; message: string}

export function useVoiceService(enabled: boolean) {
  const [status, setStatus] = useState<VoiceServiceStatus>({phase: 'loading'})
  useEffect(() => {
    if (!enabled) return
    let active = true
    let revision = 0
    const refresh = async () => {
      const current = ++revision
      try {
        const source = await modelConnectionsApi.get()
        if (!active || current !== revision) return
        setStatus({phase: (source.providers ?? []).some(isOfficialDeepSeek) ? 'ready' : 'unconfigured'})
      } catch (reason) {
        if (!active || current !== revision) return
        setStatus({phase: 'error', message: reason instanceof Error ? reason.message : '无法读取 DeepSeek 连接'})
      }
    }
    void refresh()
    window.addEventListener(MODEL_CONNECTIONS_CHANGED, refresh)
    window.addEventListener('focus', refresh)
    return () => {
      active = false
      window.removeEventListener(MODEL_CONNECTIONS_CHANGED, refresh)
      window.removeEventListener('focus', refresh)
    }
  }, [enabled])
  return status
}
