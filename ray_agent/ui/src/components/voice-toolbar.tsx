import {useEffect, useLayoutEffect, useRef, useState, type ReactNode, type Ref} from 'react'
import {Button} from '@/components/ui/button'
import {Check, Loader2, Mic, X} from '@/components/ui/icons'
import {usePrefersReducedMotion} from '@/lib/motion'
import {VOICE_LIMIT_SECONDS} from '@/lib/voice-recording'
import './voice-input.css'

export type VoicePhase = 'idle' | 'confirm' | 'setup' | 'local-setup' | 'permission' | 'recording' | 'transcribing' | 'error'

/** 麦克风位置展开成胶囊的阶段：取消、波形与计时、完成；转写中也留在胶囊里。 */
const SHEET_PHASES: ReadonlySet<VoicePhase> = new Set(['permission', 'recording', 'transcribing'])
/** 麦克风按钮的占位宽度（icon-sm），胶囊收起时保持这个宽度。 */
const ANCHOR_PX = 32

function clock(seconds: number) {
  return String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0')
}

type Layer = {key: string; node: ReactNode}

/**
 * 胶囊内容切换时保留上一层：它在 `composer-voice-layer` 里淡出，新内容同时淡入。
 * 减少动态效果时不保留上一层，内容直接切换。
 */
function useLeavingLayer(key: string, node: ReactNode, reduced: boolean) {
  const latest = useRef<Layer>({key, node})
  const [leaving, setLeaving] = useState<Layer | null>(null)
  // 先于记录新值执行：此时 latest 仍是上一次提交的层，key 变化即把它留作淡出层。
  useEffect(() => {
    const last = latest.current
    if (last.key !== key) setLeaving(reduced || last.node == null ? null : last)
  }, [key, reduced])
  useEffect(() => {
    latest.current = {key, node}
  })
  return {leaving, clear: () => setLeaving(null)}
}

/**
 * 胶囊展开时盖住的同组按钮（如快捷按钮、发送组）：与胶囊的矩形相交的兄弟组整体 inert、aria-hidden，
 * 并用 data-voice-covered 淡出；收起后去掉标记即淡回。焦点若在被盖住的按钮上，移到胶囊的第一个按钮。
 * width 为 0 时表示收起，清空全部标记。
 */
function coverSiblings(sheet: HTMLElement, width: number, covered: {current: HTMLElement[]}) {
  const control = sheet.parentElement
  const group = control?.parentElement ?? null
  const footer = group?.parentElement ?? null
  const candidates: HTMLElement[] = []
  if (control && group) {
    for (const node of Array.from(group.children)) if (node instanceof HTMLElement && node !== control) candidates.push(node)
  }
  if (group && footer && footer !== group) {
    for (const node of Array.from(footer.children)) if (node instanceof HTMLElement && node !== group) candidates.push(node)
  }
  let next: HTMLElement[] = []
  if (width > 0) {
    const rect = sheet.getBoundingClientRect()
    const right = rect.left + width
    next = candidates.filter(node => {
      const box = node.getBoundingClientRect()
      return box.width > 0 && box.left < right && box.right > rect.left && box.top < rect.bottom && box.bottom > rect.top
    })
  }
  for (const node of covered.current) {
    if (!next.includes(node)) {
      node.removeAttribute('inert')
      node.removeAttribute('aria-hidden')
      node.removeAttribute('data-voice-covered')
    }
  }
  for (const node of next) {
    node.setAttribute('inert', '')
    node.setAttribute('aria-hidden', 'true')
    node.setAttribute('data-voice-covered', '')
  }
  covered.current = next
  if (next.some(node => node.contains(document.activeElement))) sheet.querySelector<HTMLElement>('button')?.focus({preventScroll: true})
}

export function VoiceToolbar({ref, phase, seconds = 0, levels = [], error, checking, disabled, readyToRecord, method,
  localSetup, onMic, onFinish, onCancel, onRemote, onUseLocal, onConfigure, onRetry}: {
  ref?: Ref<HTMLDivElement>
  phase: VoicePhase
  seconds?: number
  levels?: number[]
  error?: string
  checking?: boolean
  disabled?: boolean
  readyToRecord?: boolean
  method?: string
  localSetup?: ReactNode
  onMic?: () => void
  onFinish?: () => void
  onCancel?: () => void
  onRemote?: () => void
  onUseLocal?: () => void
  onConfigure?: () => void
  onRetry?: () => void
}) {
  const remaining = Math.max(0, VOICE_LIMIT_SECONDS - seconds)
  const countdown = remaining <= 10
  const preparing = phase === 'setup' || phase === 'local-setup'
  const sheetOpen = SHEET_PHASES.has(phase)
  const reduced = usePrefersReducedMotion()
  const sheetRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLSpanElement>(null)
  const coveredRef = useRef<HTMLElement[]>([])

  const mic = <Button type="button" size="icon-sm" variant="ghost" className="composer-voice-trigger" aria-label="开始录音"
    title={checking ? '正在检查语音转写资源' : method ? `语音输入 · ${method}` : '语音输入'}
    aria-busy={checking || undefined} disabled={disabled || checking || (preparing && !readyToRecord)} onClick={onMic}>
    <Mic aria-hidden className="size-4"/>
  </Button>
  const cancel = <Button type="button" size="icon-xs" variant="ghost" title="取消（Esc）" aria-label="取消语音输入"
    aria-keyshortcuts="Escape" onClick={onCancel}><X aria-hidden/></Button>

  const sheetContent: ReactNode = phase === 'permission' ? <>
    {cancel}
    <span role="status" className="composer-voice-status">
      <Loader2 className="size-3.5 motion-safe:animate-spin" aria-hidden/>正在启动录音
    </span>
  </> : phase === 'recording' ? <>
    {cancel}
    <span role="status" className="sr-only">正在录音</span>
    <span aria-hidden className="composer-voice-wave">
      {Array.from({length: 12}, (_, index) => {
        const level = levels[index + levels.length - 12] ?? 0
        return <i key={index} style={{height: 3 + level * 13}}/>
      })}
    </span>
    <time className="composer-voice-time" data-countdown={countdown} aria-label={countdown ? `剩余 ${remaining} 秒` : `已录音 ${seconds} 秒`}>
      {countdown && <span>剩余</span>}{clock(countdown ? remaining : seconds)}
    </time>
    <Button type="button" size="icon-xs" variant="ghost" className="composer-voice-finish" aria-label="完成录音"
      aria-keyshortcuts="Enter" title="完成录音（Enter）" onClick={onFinish}><Check aria-hidden/></Button>
  </> : phase === 'transcribing' ? <>
    {cancel}
    <span role="status" className="composer-voice-status">
      <Loader2 className="size-3.5 motion-safe:animate-spin" aria-hidden/>正在转写
    </span>
  </> : null

  const stage = useLeavingLayer(sheetOpen ? phase : 'closed', sheetContent, reduced)

  // 胶囊宽度取内容的自然宽度；内容变化（如计时、阶段切换）时跟随。收起时回到麦克风的宽度。
  useLayoutEffect(() => {
    const sheet = sheetRef.current
    const stageNode = stageRef.current
    if (!sheet || !stageNode) return
    const apply = () => {
      const width = sheetOpen ? Math.max(ANCHOR_PX, stageNode.offsetWidth) : ANCHOR_PX
      sheet.style.width = `${width}px`
      coverSiblings(sheet, sheetOpen ? width : 0, coveredRef)
    }
    apply()
    // 收起时宽度固定为占位宽度，不需要观察内容尺寸；清理时恢复被盖住的按钮。
    if (!sheetOpen || typeof ResizeObserver === 'undefined') return () => coverSiblings(sheet, 0, coveredRef)
    const observer = new ResizeObserver(apply)
    observer.observe(stageNode)
    return () => {
      observer.disconnect()
      coverSiblings(sheet, 0, coveredRef)
    }
  }, [sheetOpen])

  const inline = !sheetOpen && phase !== 'idle'
  return <div ref={ref} data-voice-toolbar data-phase={phase} data-mode={sheetOpen ? 'sheet' : inline ? 'inline' : 'idle'}
    data-expanded={preparing || phase === 'confirm' || phase === 'error' || undefined}
    className="composer-voice-control" role="group" aria-label="语音输入"
    tabIndex={phase === 'confirm' || preparing ? -1 : undefined}>
    {phase === 'idle' && <span key="idle" className="composer-voice-group composer-voice-enter">{mic}</span>}
    {/* 胶囊展开时麦克风位置留出占位，周围按钮不因展开而移动 */}
    {sheetOpen && <span aria-hidden className="composer-voice-anchor"/>}
    <div ref={sheetRef} className="composer-voice-sheet" data-open={sheetOpen}
      aria-hidden={!sheetOpen || undefined} inert={!sheetOpen}>
      <span ref={stageRef} className="composer-voice-stage">
        {stage.leaving && <span key={`leaving-${stage.leaving.key}`} className="composer-voice-layer" data-leaving="true" inert aria-hidden
          onAnimationEnd={event => {if (event.target === event.currentTarget) stage.clear()}}>{stage.leaving.node}</span>}
        {sheetOpen && <span key={phase} className="composer-voice-layer composer-voice-enter">{sheetContent}</span>}
      </span>
    </div>
    {inline && <span key={phase} className="composer-voice-group composer-voice-enter">
      {phase === 'confirm' && <>
        <span role="status">录音将上传至 DeepSeek，按时长计费。</span>
        <div className="composer-voice-buttons">
          <Button type="button" size="xs" variant="outline" disabled={disabled} onClick={onRemote}>使用远程</Button>
          <Button type="button" size="xs" variant="ghost" onClick={onUseLocal}>改用本地</Button>
          {cancel}
        </div>
      </>}
      {preparing && <>
        {mic}
        {localSetup}
        {phase === 'setup' && <Button type="button" size="xs" variant="ghost" onClick={onConfigure}>配置远程服务</Button>}
        {cancel}
      </>}
      {phase === 'error' && <>
        <span role="alert" className="composer-voice-error" title={error}>{error}</span>
        <div className="composer-voice-buttons">
          <Button type="button" size="xs" variant="outline" disabled={disabled} onClick={onRetry}>重试</Button>
          <Button type="button" size="xs" variant="ghost" aria-keyshortcuts="Escape" onClick={onCancel}>丢弃</Button>
        </div>
      </>}
    </span>}
  </div>
}
