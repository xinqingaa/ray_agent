import {useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react'
import {useVoiceModel, VoiceModelStatus} from '@/components/voice-model-status'
import {VoiceToolbar, type VoicePhase} from '@/components/voice-toolbar'
import {setUsagePreferences} from '@/hooks/use-usage-preferences'
import {useVoiceService} from '@/hooks/use-voice-service'
import {USAGE_RECORDED, usageApi, type VoiceEngine} from '@/lib/api/usage'
import {openSettingsSection} from '@/lib/settings-navigation'
import {VOICE_OPTIONS} from '@/lib/voice-options'
import {openVoiceRecording, type VoiceRecording} from '@/lib/voice-recording'

type VoiceAttempt = {engine: VoiceEngine; controller: AbortController; starting: boolean; transcribing: boolean}

export function VoiceInput({sessionId, disabled, engine, fill, focusDraft, onBusyChange}: {
  sessionId?: string | null
  disabled: boolean
  engine: VoiceEngine | null
  fill: (text: string) => void
  focusDraft: () => void
  onBusyChange: (busy: boolean) => void
}) {
  const [phase, setPhase] = useState<VoicePhase>('idle')
  const [seconds, setSeconds] = useState(0)
  const [levels, setLevels] = useState<number[]>([])
  const [error, setError] = useState('')
  const active = useRef<VoiceRecording | null>(null)
  const attempt = useRef<VoiceAttempt | null>(null)
  const recorded = useRef<Blob | null>(null)
  const lastEngine = useRef<VoiceEngine | null>(null)
  const toolbar = useRef<HTMLDivElement>(null)
  const fillRef = useRef(fill)
  const focusDraftRef = useRef(focusDraft)
  useLayoutEffect(() => {fillRef.current = fill; focusDraftRef.current = focusDraft}, [fill, focusDraft])

  const preparing = phase === 'setup' || phase === 'local-setup'
  const model = useVoiceModel(engine !== 'deepseek' || preparing, preparing)
  const localReady = model.item?.state === 'available'
  const remote = useVoiceService(engine !== 'deepseek' && !localReady)
  const checking = engine !== 'deepseek' && !localReady && (!model.items && !model.error || remote.phase === 'loading')
  const busy = phase === 'permission' || phase === 'recording' || phase === 'transcribing'
  useLayoutEffect(() => {
    onBusyChange(busy)
    return () => onBusyChange(false)
  }, [busy, onBusyChange])

  const release = useCallback(() => {
    attempt.current?.controller.abort()
    attempt.current = null
    active.current = null
    recorded.current = null
  }, [])

  const reset = useCallback(() => {
    release()
    lastEngine.current = null
    setError('')
    setPhase('idle')
  }, [release])

  const discard = useCallback(() => {
    reset()
    focusDraftRef.current()
  }, [reset])

  useLayoutEffect(() => release, [release])
  useEffect(() => {
    if (attempt.current && engine !== attempt.current.engine) reset()
  }, [engine, reset])

  useEffect(() => {
    if (preparing || phase === 'confirm') toolbar.current?.focus({preventScroll: true})
  }, [phase, preparing])

  const send = useCallback(async (audio: Blob, current: VoiceAttempt) => {
    const {engine: chosen, controller: {signal}} = current
    if (signal.aborted || current.transcribing) return
    current.transcribing = true
    setPhase('transcribing')
    setError('')
    try {
      const result = await usageApi.transcribe(audio, chosen, sessionId, signal)
      if (signal.aborted) return
      if (!result.text.trim()) throw new Error('没有识别到文字，可重试或重新录音。')
      reset()
      fillRef.current(result.text.trim())
    } catch (reason) {
      if (signal.aborted) return
      setError(reason instanceof Error ? reason.message : '转写失败')
      setPhase('error')
    } finally {
      current.transcribing = false
      window.dispatchEvent(new Event(USAGE_RECORDED))
    }
  }, [reset, sessionId])

  const finish = useCallback(() => {
    const capture = active.current
    const current = attempt.current
    if (!current || !capture) return
    active.current = null
    try {
      const audio = capture.finish()
      recorded.current = audio
      void send(audio, current)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '录音读取失败')
      setPhase('error')
    }
  }, [send])

  useEffect(() => {
    if (phase === 'idle') return
    const handleKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229 ||
        document.querySelector('[role=dialog][data-state=open]')) return
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        discard()
      }
      const composer = toolbar.current?.closest('[data-chat-composer]')
      if (phase === 'recording' && event.key === 'Enter' && !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey &&
        event.target instanceof Node && composer?.contains(event.target)) {
        event.preventDefault()
        event.stopPropagation()
        if (!event.repeat) finish()
      }
    }
    document.addEventListener('keydown', handleKey, true)
    return () => document.removeEventListener('keydown', handleKey, true)
  }, [discard, finish, phase])

  const start = async (chosen: VoiceEngine) => {
    if (busy || disabled || attempt.current?.starting) return
    release()
    const controller = new AbortController()
    const current = {engine: chosen, controller, starting: true, transcribing: false}
    attempt.current = current
    lastEngine.current = chosen
    setPhase('permission')
    setError('')
    setSeconds(0)
    setLevels([])
    let limitReached = false
    try {
      const recording = openVoiceRecording({
        signal: controller.signal,
        onMeter(elapsed, level) {
          if (controller.signal.aborted) return
          setLevels(previous => [...previous.slice(-11), level])
          setSeconds(Math.floor(elapsed))
        },
        onLimit() {
          if (controller.signal.aborted) return
          limitReached = true
          finish()
        },
      })
      focusDraftRef.current()
      const preference = chosen === engine ? null : setUsagePreferences({voice: chosen})
      const [capture] = await Promise.all([recording, preference])
      if (controller.signal.aborted) return
      current.starting = false
      active.current = capture
      if (limitReached) finish()
      else setPhase('recording')
    } catch (reason) {
      if (controller.signal.aborted) return
      release()
      const denied = reason instanceof Error && ['NotAllowedError', 'PermissionDeniedError', 'SecurityError'].includes(reason.name)
      setError(denied ? '麦克风权限未开启。请前往「系统设置 → 隐私与安全性 → 麦克风」允许 RayAgent。'
        : reason instanceof Error ? reason.message : '无法启动录音')
      setPhase('error')
    }
  }

  const choose = () => {
    if (phase === 'local-setup') {
      if (localReady) void start('local')
    } else if (engine === 'deepseek') void start(engine)
    else if (localReady) void start('local')
    else if (remote.phase === 'ready') setPhase('confirm')
    else setPhase('setup')
  }

  return <VoiceToolbar ref={toolbar} phase={phase} seconds={seconds} levels={levels} error={error}
    checking={checking} disabled={disabled} method={engine ? VOICE_OPTIONS[engine].label : undefined}
    readyToRecord={localReady || (phase === 'setup' && remote.phase === 'ready')}
    localSetup={preparing ? <VoiceModelStatus model={model} compact/> : undefined}
    onMic={choose} onFinish={finish} onCancel={discard} onRemote={() => void start('deepseek')}
    onUseLocal={() => setPhase('local-setup')}
    onConfigure={() => {discard(); openSettingsSection('llm')}}
    onRetry={() => {
      if (recorded.current && attempt.current) void send(recorded.current, attempt.current)
      else if (lastEngine.current) void start(lastEngine.current)
    }}/>
}
