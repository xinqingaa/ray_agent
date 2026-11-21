import {useEffect, useRef, useState} from 'react'
import {createPortal} from 'react-dom'
import {toast} from 'sonner'
import {Button} from '@/components/ui/button'
import {AlertCircle, Check, Loader2, Mic, RefreshCw} from '@/components/ui/icons'
import {setUsagePreferences} from '@/hooks/use-usage-preferences'
import {isOfficialDeepSeek, modelConnectionsApi} from '@/lib/api/model-connections'
import {USAGE_RECORDED, usageApi} from '@/lib/api/usage'
import {openSettingsSection} from '@/lib/settings-navigation'
import {VOICE_LIMIT_SECONDS, voiceWav} from '@/lib/voice-recording'
import './voice-input.css'

type Capture = {
  stream: MediaStream
  context: AudioContext
  input: MediaStreamAudioSourceNode
  processor: ScriptProcessorNode
  chunks: Float32Array[]
  frames: number
}
/** offer：首次点击麦克风时，就地说明转写去向并请求确认；确认后才开始录音。 */
type Phase = 'idle' | 'offer' | 'permission' | 'recording' | 'transcribing' | 'error'

function release(capture: Capture | null) {
  if (!capture) return
  capture.processor.onaudioprocess = null
  capture.processor.disconnect()
  capture.input.disconnect()
  capture.stream.getTracks().forEach(track => track.stop())
  void capture.context.close().catch(() => {})
}

/**
 * 输入框的麦克风。`enabled` 为假（语音转写未选择）时，首次点击进入 offer 确认；
 * 确认时在点击的同步阶段开始录音（保留 WebView 的用户操作授权），再保存偏好。
 */
export function VoiceInput({sessionId, disabled, enabled, fill, stripHost, onCancel, onBusyChange}: {
  sessionId?: string | null
  disabled: boolean
  enabled: boolean
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
  /** offer 阶段检查官方 DeepSeek 连接：null 为检查中 */
  const [offerReady, setOfferReady] = useState<boolean | null>(null)
  const active = useRef<Capture | null>(null)
  const pendingContext = useRef<AudioContext | null>(null)
  const recorded = useRef<Blob | null>(null)
  const generation = useRef(0)
  const fillRef = useRef(fill)
  const cancelRef = useRef(onCancel)
  useEffect(() => {fillRef.current = fill}, [fill])
  useEffect(() => {cancelRef.current = onCancel}, [onCancel])

  const busy = phase === 'permission' || phase === 'recording' || phase === 'transcribing'
  useEffect(() => {
    onBusyChange(busy)
    return () => onBusyChange(false)
  }, [busy, onBusyChange])

  const discard = () => {
    if (pendingContext.current) void pendingContext.current.close().catch(() => {})
    pendingContext.current = null
    generation.current += 1
    release(active.current)
    active.current = null
    recorded.current = null
    setHasAudio(false)
    setError('')
    setPhase('idle')
    cancelRef.current()
  }

  useEffect(() => () => {
    generation.current += 1
    if (pendingContext.current) void pendingContext.current.close().catch(() => {})
    pendingContext.current = null
    release(active.current)
    active.current = null
    recorded.current = null
  }, [])
  useEffect(() => {
    if (phase === 'idle' || phase === 'transcribing') return
    const cancel = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented && !document.querySelector('[role=dialog][data-state=open]')) {
        event.preventDefault()
        event.stopPropagation()
        discard()
      }
    }
    document.addEventListener('keydown', cancel, true)
    return () => document.removeEventListener('keydown', cancel, true)
  }, [phase])

  const openOffer = () => {
    setError('')
    setOfferReady(null)
    setPhase('offer')
    modelConnectionsApi.get()
      .then(source => setOfferReady((source.providers ?? []).some(isOfficialDeepSeek)))
      .catch(() => setOfferReady(false))
  }

  /** 确认启用：录音与保存偏好并行。保存失败则丢弃这次录音并提示。 */
  const enableAndRecord = () => {
    void start()
    setUsagePreferences({voice: 'deepseek'}).catch(reason => {
      discard()
      toast.error(`启用语音转写失败：${reason instanceof Error ? reason.message : '请重试'}`)
    })
  }

  const send = async (audio: Blob) => {
    const request = ++generation.current
    setPhase('transcribing')
    setError('')
    try {
      const result = await usageApi.transcribe(audio, sessionId)
      if (request !== generation.current) return
      if (!result.text.trim()) throw new Error('没有识别到文字，可重试或重新录音。')
      recorded.current = null
      setHasAudio(false)
      setPhase('idle')
      window.dispatchEvent(new Event(USAGE_RECORDED))
      fillRef.current(result.text.trim())
    } catch (reason) {
      if (request !== generation.current) return
      window.dispatchEvent(new Event(USAGE_RECORDED))
      setError(reason instanceof Error ? reason.message : '转写失败')
      setPhase('error')
    }
  }

  const finish = () => {
    const capture = active.current
    if (!capture) return
    release(capture)
    active.current = null
    try {
      const audio = voiceWav(capture.chunks, capture.context.sampleRate)
      recorded.current = audio
      setHasAudio(true)
      void send(audio)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '录音读取失败')
      setPhase('error')
    }
  }

  const start = async () => {
    const request = ++generation.current
    setPhase('permission')
    setSeconds(0)
    setLevels([])
    let stream: MediaStream | null = null
    let context: AudioContext | null = null
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('当前窗口无法使用麦克风，请在桌面应用中打开。')
      // 在点击时创建音频上下文，以保留 WebView 的用户操作授权。
      context = new AudioContext()
      pendingContext.current = context
      await context.resume()
      stream = await navigator.mediaDevices.getUserMedia({audio: {channelCount: 1}})
      if (request !== generation.current) {
        stream.getTracks().forEach(track => track.stop())
        void context.close().catch(() => {})
        return
      }
      const input = context.createMediaStreamSource(stream)
      const processor = context.createScriptProcessor(4096, 1, 1)
      const capture: Capture = {stream, context, input, processor, chunks: [], frames: 0}
      const sampleRate = context.sampleRate
      const maxFrames = sampleRate * VOICE_LIMIT_SECONDS
      active.current = capture
      pendingContext.current = null
      let lastMeter = 0
      processor.onaudioprocess = event => {
        if (active.current !== capture) return
        const samples = event.inputBuffer.getChannelData(0).slice(0, maxFrames - capture.frames)
        capture.chunks.push(samples)
        capture.frames += samples.length
        const elapsed = capture.frames / sampleRate
        if (elapsed - lastMeter > 0.08) {
          lastMeter = elapsed
          const energy = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / Math.max(1, samples.length))
          setLevels(previous => [...previous.slice(-19), Math.min(1, energy * 8)])
          setSeconds(Math.floor(elapsed))
        }
        if (capture.frames >= maxFrames) finish()
      }
      input.connect(processor)
      processor.connect(context.destination)
      setPhase('recording')
    } catch (reason) {
      stream?.getTracks().forEach(track => track.stop())
      if (pendingContext.current === context) pendingContext.current = null
      if (context) void context.close().catch(() => {})
      if (request !== generation.current) return
      const denied = reason instanceof Error && ['NotAllowedError', 'PermissionDeniedError', 'SecurityError'].includes(reason.name)
      setError(denied ? '麦克风权限未开启。请前往「系统设置 → 隐私与安全性 → 麦克风」允许 RayAgent。'
        : reason instanceof Error ? reason.message : '无法启动录音')
      setPhase('error')
    }
  }

  const clock = String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0')
  const offerStrip = <div className="composer-voice-strip" data-phase="offer">
    <span className="composer-voice-status" role="status">
      <Mic className="mt-0.5 size-3.5 shrink-0" aria-hidden/>
      <span>{offerReady == null ? '正在检查 DeepSeek 连接…'
        : offerReady ? '录音会发送到 DeepSeek 转写，按时长计费并计入用量。可在「设置 → 通用」中关闭。'
        : '语音转写需要先配置官方 DeepSeek 连接及 API Key。'}</span>
    </span>
    <div className="composer-voice-actions">
      {offerReady === false && <Button type="button" size="xs" variant="outline" onClick={() => {discard(); openSettingsSection('llm')}}>前往模型提供商</Button>}
      <Button type="button" size="xs" variant="ghost" onClick={discard}>取消<kbd>Esc</kbd></Button>
      <Button type="button" size="xs" disabled={offerReady !== true || disabled} onClick={enableAndRecord}>
        <Mic aria-hidden/>启用并录音
      </Button>
    </div>
  </div>
  const strip = phase === 'offer' ? offerStrip : phase !== 'idle' && <div className="composer-voice-strip" data-phase={phase}>
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
      <Loader2 className="size-3.5 animate-spin" aria-hidden/>正在转写 {clock} 的录音 <span className="text-faint">· DeepSeek</span>
    </span>}
    {phase === 'error' && <span role="alert" className="composer-voice-status text-state-failed">
      <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden/><span>{error}{hasAudio && ' 录音已保留。'}</span>
    </span>}
    {phase !== 'transcribing' && <div className="composer-voice-actions">
      <Button type="button" size="xs" variant="ghost" onClick={discard}>
        {hasAudio ? '丢弃' : '取消'}<kbd>Esc</kbd>
      </Button>
      {phase === 'recording' && <Button type="button" size="xs" variant="outline" onClick={finish}>
        <Check aria-hidden/>完成
      </Button>}
      {phase === 'error' && hasAudio && <Button type="button" size="xs" variant="outline" disabled={disabled}
        onClick={() => {if (recorded.current) void send(recorded.current)}}><RefreshCw aria-hidden/>重试</Button>}
    </div>}
  </div>
  return <>
    {strip && stripHost && createPortal(strip, stripHost)}
    <Button type="button" variant="ghost" size="icon-sm" className="composer-voice-trigger"
      aria-pressed={phase === 'recording'} aria-label={phase === 'recording' ? '结束录音并转写' : '开始录音'}
      title={phase === 'recording' ? '结束录音并转写' : enabled ? '语音输入 · DeepSeek' : '语音输入（首次使用需确认）'}
      disabled={phase === 'transcribing' || phase === 'permission' || hasAudio || (disabled && phase !== 'recording')}
      onClick={() => {
        if (phase === 'recording') finish()
        if (phase === 'offer') return
        if (!enabled) {
          if (phase === 'idle' || phase === 'error') openOffer()
          return
        }
        if (phase === 'idle' || (phase === 'error' && !hasAudio)) void start()
      }}><Mic aria-hidden className="size-4"/></Button>
  </>
}
