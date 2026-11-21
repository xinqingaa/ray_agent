import {useCallback, useEffect, useId, useRef, useState} from 'react'
import {createPortal} from 'react-dom'
import {Button} from '@/components/ui/button'
import {AlertCircle, Check, Loader2, Mic, RefreshCw} from '@/components/ui/icons'
import {useVoiceModel, VoiceModelStatus} from '@/components/voice-model-status'
import {setUsagePreferences} from '@/hooks/use-usage-preferences'
import {isOfficialDeepSeek, modelConnectionsApi} from '@/lib/api/model-connections'
import {USAGE_RECORDED, usageApi, type VoiceEngine} from '@/lib/api/usage'
import {openSettingsSection} from '@/lib/settings-navigation'
import {VOICE_OPTIONS} from '@/lib/voice-options'
import {openVoiceRecording, type VoiceRecording} from '@/lib/voice-recording'
import './voice-input.css'

type Phase = 'idle' | 'offer' | 'permission' | 'recording' | 'transcribing' | 'error'
type VoiceAttempt = {engine: VoiceEngine; controller: AbortController}

export function VoiceInput({sessionId, disabled, engine, fill, stripHost, onCancel, onBusyChange}: {
  sessionId?: string | null
  disabled: boolean
  engine: VoiceEngine | null
  fill: (text: string) => void
  stripHost: HTMLDivElement | null
  onCancel: () => void
  onBusyChange: (busy: boolean) => void
}) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [seconds, setSeconds] = useState(0)
  const [levels, setLevels] = useState<number[]>([])
  const [error, setError] = useState('')
  const [hasAudio, setHasAudio] = useState(false)
  const [cloudReady, setCloudReady] = useState<boolean | null>(null)
  const active = useRef<VoiceRecording | null>(null)
  const attempt = useRef<VoiceAttempt | null>(null)
  const recorded = useRef<Blob | null>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const offerTitle = useRef<HTMLHeadingElement>(null)
  const offerId = useId()
  const fillRef = useRef(fill)
  const cancelRef = useRef(onCancel)
  useEffect(() => {fillRef.current = fill}, [fill])
  useEffect(() => {cancelRef.current = onCancel}, [onCancel])

  const visibleOffer = phase === 'offer'
  const model = useVoiceModel(engine === 'local' || visibleOffer, visibleOffer)
  const localReady = model.item?.state === 'available' && !model.error
  const busy = phase === 'permission' || phase === 'recording' || phase === 'transcribing'
  useEffect(() => {
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
    setHasAudio(false)
    setError('')
    setPhase('idle')
  }, [release])

  const discard = useCallback(() => {
    reset()
    if (visibleOffer) trigger.current?.focus()
    else cancelRef.current()
  }, [reset, visibleOffer])

  useEffect(() => release, [release])
  useEffect(() => {
    if (attempt.current && engine !== attempt.current.engine) reset()
  }, [engine, reset])
  useEffect(() => {
    if (phase === 'idle') return
    const cancel = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented && !document.querySelector('[role=dialog][data-state=open]')) {
        event.preventDefault()
        event.stopPropagation()
        discard()
      }
    }
    document.addEventListener('keydown', cancel, true)
    return () => document.removeEventListener('keydown', cancel, true)
  }, [discard, phase])

  useEffect(() => {
    if (!visibleOffer) return
    offerTitle.current?.focus()
    let disposed = false
    modelConnectionsApi.get()
      .then(source => {if (!disposed) setCloudReady((source.providers ?? []).some(isOfficialDeepSeek))})
      .catch(() => {if (!disposed) setCloudReady(false)})
    return () => {disposed = true}
  }, [visibleOffer])

  const send = async (audio: Blob, current: VoiceAttempt) => {
    const {engine: chosen, controller: {signal}} = current
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
      window.dispatchEvent(new Event(USAGE_RECORDED))
    }
  }

  const finish = () => {
    const capture = active.current
    const current = attempt.current
    if (!current || !capture) return
    active.current = null
    try {
      const audio = capture.finish()
      recorded.current = audio
      setHasAudio(true)
      void send(audio, current)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '录音读取失败')
      setPhase('error')
    }
  }

  const start = async (chosen: VoiceEngine) => {
    if (busy || disabled) return
    release()
    const controller = new AbortController()
    attempt.current = {engine: chosen, controller}
    setPhase('permission')
    setError('')
    setSeconds(0)
    setLevels([])
    try {
      const recording = openVoiceRecording({
        signal: controller.signal,
        onMeter(elapsed, level) {
          setLevels(previous => [...previous.slice(-19), level])
          setSeconds(Math.floor(elapsed))
        },
        onLimit: finish,
      })
      const preference = chosen === engine ? null : setUsagePreferences({voice: chosen})
      const [capture] = await Promise.all([recording, preference])
      if (controller.signal.aborted) return
      active.current = capture
      setPhase('recording')
    } catch (reason) {
      if (controller.signal.aborted) return
      release()
      const denied = reason instanceof Error && ['NotAllowedError', 'PermissionDeniedError', 'SecurityError'].includes(reason.name)
      setError(denied ? '麦克风权限未开启。请前往「系统设置 → 隐私与安全性 → 麦克风」允许 RayAgent。'
        : reason instanceof Error ? reason.message : '无法启动录音')
      setPhase('error')
    }
  }

  const clock = String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0')
  const chosen = attempt.current?.engine ?? engine
  const offerStrip = <section id={offerId} aria-labelledby={offerId + '-title'} className="composer-voice-strip" data-phase="offer">
    <h3 id={offerId + '-title'} ref={offerTitle} tabIndex={-1} className="font-medium text-foreground">选择语音转写方式</h3>
    <div className="composer-voice-options">
      <div className="composer-voice-option">
        <h4>{VOICE_OPTIONS.local.label}</h4>
        <p>{VOICE_OPTIONS.local.description}</p>
        <div className="composer-voice-choice">
          <VoiceModelStatus model={model}/>
          {localReady && <Button type="button" size="xs" variant="outline" disabled={disabled}
            onClick={() => void start('local')}>用本机录音</Button>}
        </div>
      </div>
      <div className="composer-voice-option">
        <h4>{VOICE_OPTIONS.deepseek.label}</h4>
        <p>{VOICE_OPTIONS.deepseek.description}</p>
        <div className="composer-voice-choice">
          {cloudReady === true && <Button type="button" size="xs" variant="outline" disabled={disabled}
            onClick={() => void start('deepseek')}>用 DeepSeek 录音</Button>}
          {cloudReady === false && <>
            <span role="status">需要官方 DeepSeek 连接及 API Key</span>
            <Button type="button" size="xs" variant="outline" onClick={() => {discard(); openSettingsSection('llm')}}>前往模型提供商</Button>
          </>}
          {cloudReady === null && <span role="status">正在检查 DeepSeek 连接…</span>}
        </div>
      </div>
    </div>
    <div className="composer-voice-actions">
      <Button type="button" size="xs" variant="ghost" onClick={discard}>取消<kbd>Esc</kbd></Button>
    </div>
  </section>

  const strip = visibleOffer ? offerStrip : phase !== 'idle' && <div className="composer-voice-strip" data-phase={phase}>
    {phase === 'permission' && <span className="composer-voice-status" role="status">
      <Loader2 className="size-3.5 animate-spin" aria-hidden/>等待麦克风授权
    </span>}
    {phase === 'recording' && <>
      <span className="composer-voice-dot" aria-hidden/>
      <span role="status">正在录音</span>
      <time className="composer-voice-time">{clock}</time>
      <span aria-hidden className="composer-voice-wave">
        {Array.from({length: 18}, (_, index) => {
          const level = levels[index + levels.length - 18] ?? 0
          return <i key={index} style={{height: 3 + level * 15}}/>
        })}
      </span>
    </>}
    {phase === 'transcribing' && <span role="status" className="composer-voice-status">
      <Loader2 className="size-3.5 animate-spin" aria-hidden/>正在转写 {clock} 的录音
      {chosen && <span className="text-faint">· {VOICE_OPTIONS[chosen].label}</span>}
    </span>}
    {phase === 'error' && <span role="alert" className="composer-voice-status text-state-failed">
      <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden/><span>{error}{hasAudio && ' 录音已保留。'}</span>
    </span>}
    <div className="composer-voice-actions">
      <Button type="button" size="xs" variant="ghost" onClick={discard}>
        {phase === 'error' && hasAudio ? '丢弃' : '取消'}<kbd>Esc</kbd>
      </Button>
      {phase === 'recording' && <Button type="button" size="xs" variant="outline" onClick={finish}>
        <Check aria-hidden/>完成
      </Button>}
      {phase === 'error' && hasAudio && <Button type="button" size="xs" variant="outline" disabled={disabled}
        onClick={() => {if (recorded.current && attempt.current) void send(recorded.current, attempt.current)}}>
        <RefreshCw aria-hidden/>重试
      </Button>}
    </div>
  </div>
  return <>
    {strip && stripHost && createPortal(strip, stripHost)}
    <Button ref={trigger} type="button" variant="ghost" size="icon-sm" className="composer-voice-trigger"
      aria-expanded={visibleOffer} aria-controls={visibleOffer ? offerId : undefined}
      aria-pressed={phase === 'recording'} aria-label={phase === 'recording' ? '结束录音并转写' : '开始录音'}
      title={phase === 'recording' ? '结束录音并转写' : engine ? '语音输入 · ' + VOICE_OPTIONS[engine].label : '选择语音转写方式'}
      disabled={phase === 'transcribing' || phase === 'permission' || hasAudio || (disabled && phase !== 'recording')}
      onClick={() => {
        if (phase === 'recording') {
          finish()
          return
        }
        if (visibleOffer) {
          discard()
          return
        }
        if (engine === 'deepseek' || (engine === 'local' && localReady)) {
          void start(engine)
        } else {
          setCloudReady(null)
          setPhase('offer')
        }
      }}><Mic aria-hidden className="size-4"/></Button>
  </>
}
