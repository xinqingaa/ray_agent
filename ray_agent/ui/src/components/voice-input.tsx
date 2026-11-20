import {useEffect, useRef, useState} from 'react'
import {createPortal} from 'react-dom'
import {Button} from '@/components/ui/button'
import {AlertCircle, Check, Loader2, Mic, RefreshCw} from '@/components/ui/icons'
import {USAGE_RECORDED, usageApi} from '@/lib/api/usage'
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
type Phase = 'idle' | 'permission' | 'recording' | 'transcribing' | 'error'

function release(capture: Capture | null) {
  if (!capture) return
  capture.processor.onaudioprocess = null
  capture.processor.disconnect()
  capture.input.disconnect()
  capture.stream.getTracks().forEach(track => track.stop())
  void capture.context.close().catch(() => {})
}

export function VoiceInput({sessionId, disabled, fill, stripHost, onCancel, onBusyChange}: {
  sessionId?: string | null
  disabled: boolean
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
  const strip = phase !== 'idle' && <div className="composer-voice-strip" data-phase={phase}>
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
      title={phase === 'recording' ? '结束录音并转写' : '语音输入 · DeepSeek'}
      disabled={phase === 'transcribing' || phase === 'permission' || hasAudio || (disabled && phase !== 'recording')}
      onClick={() => {
        if (phase === 'recording') finish()
        if (phase === 'idle' || (phase === 'error' && !hasAudio)) void start()
      }}><Mic aria-hidden className="size-4"/></Button>
  </>
}
