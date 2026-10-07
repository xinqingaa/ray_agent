'use client'
import {useEffect, useMemo, useRef, useState} from 'react'
import {Check, ChevronDown} from 'lucide-react'
import {configApi} from '@/lib/api/config'
import {sessionApi} from '@/lib/api/session'
import type {ModelCatalog} from '@/lib/api/types'
import {Popover, PopoverContent, PopoverTrigger} from '@/components/ui/popover'
import {Button} from '@/components/ui/button'
import {Switch} from '@/components/ui/switch'
import {cn} from '@/lib/utils'
import {selectModel, thinkingOptions, type ModelSelection} from '@/lib/model-selection'
export type {ModelSelection} from '@/lib/model-selection'

function EffortSlider({options, value, disabled, onChange}: {
  options: {id: string}[]
  value: string
  disabled: boolean
  onChange: (id: string) => void
}) {
  const [dragging, setDragging] = useState(false)
  const drag = useRef<{origin: number; active: boolean} | null>(null)
  const index = Math.max(0, options.findIndex(option => option.id === value))
  const max = Math.max(0, options.length - 1)
  const pct = max === 0 ? 0 : (index / max) * 100
  function move(next: number) {
    const id = options[Math.min(max, Math.max(0, next))]?.id
    if (id) onChange(id)
  }
  function indexAt(el: HTMLElement, clientX: number) {
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0 || max === 0) return 0
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    return Math.round(ratio * max)
  }
  const motion = dragging ? 'transition-none' : 'transition-[left,width] duration-200 ease-out motion-reduce:transition-none'
  return <div className="mt-3">
    <div
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label="思考强度"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={index}
      aria-valuetext={disabled ? '思考已关闭' : value}
      aria-disabled={disabled || undefined}
      onKeyDown={event => {
        if (disabled) return
        if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {event.preventDefault(); move(index + 1)}
        else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {event.preventDefault(); move(index - 1)}
        else if (event.key === 'Home') {event.preventDefault(); move(0)}
        else if (event.key === 'End') {event.preventDefault(); move(max)}
      }}
      onPointerDown={event => {
        if (disabled) return
        event.currentTarget.setPointerCapture(event.pointerId)
        drag.current = {origin: event.clientX, active: false}
        move(indexAt(event.currentTarget, event.clientX))
      }}
      onPointerMove={event => {
        const current = drag.current
        if (!current) return
        if (!current.active && Math.abs(event.clientX - current.origin) > 3) {
          current.active = true
          setDragging(true)
        }
        move(indexAt(event.currentTarget, event.clientX))
      }}
      onPointerUp={() => {drag.current = null; setDragging(false)}}
      onPointerCancel={() => {drag.current = null; setDragging(false)}}
      className={cn('relative flex h-6 touch-none items-center outline-none focus-visible:ring-2 focus-visible:ring-ring', disabled ? 'cursor-default opacity-40' : 'cursor-pointer')}
    >
      <span className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-border"/>
      <span className={cn('absolute left-0 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-signal', motion)} style={{width: `${pct}%`}}/>
      <span className={cn('absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-signal', motion)} style={{left: `${pct}%`}}/>
    </div>
    <div className="flex justify-between gap-1">{options.map(option => <button type="button" key={option.id} disabled={disabled} onClick={() => onChange(option.id)}
      className={cn('min-h-8 rounded px-1 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40', !disabled && value === option.id ? 'font-semibold text-signal' : 'text-muted-foreground')}>{option.id}</button>)}</div>
  </div>
}

export function ModelPicker({sessionId, savedModel, savedReasoning, runModel, runReasoning, onSelection}: {
  sessionId?: string | null; savedModel?: string | null; savedReasoning?: string | null;
  runModel?: string | null; runReasoning?: string | null; onSelection: (selection: ModelSelection | null) => void;
}) {
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null)
  const [picked, setPicked] = useState<ModelSelection | null>(null)
  const [draft, setDraft] = useState<ModelSelection | null>(null)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [scope, setScope] = useState(sessionId)
  const request = useRef(0)
  const lastEffort = useRef<Record<string, string>>({})
  if (scope !== sessionId) {setScope(sessionId); setPicked(null); setDraft(null); setOpen(false); setSaving(false); setError(null)}
  useEffect(() => {
    let cancelled = false
    configApi.getModels().then(data => {if (!cancelled) setCatalog(data.provider && data.models.length ? data : null)})
      .catch(() => {if (!cancelled) setCatalog(null)})
    return () => {cancelled = true}
  }, [])
  useEffect(() => {request.current += 1; return () => {request.current += 1}}, [sessionId])
  const selection = picked ?? (catalog?.default_model ? {
    model: savedModel || catalog.default_model,
    reasoning: savedReasoning || catalog.models.find(item => item.id === (savedModel || catalog.default_model))?.default_choice || '',
  } : null)
  const committed = useMemo(() => picked ?? (savedModel && savedReasoning ? {model: savedModel, reasoning: savedReasoning} : null), [picked, savedModel, savedReasoning])
  useEffect(() => {onSelection(committed)}, [onSelection, committed])
  if (!catalog || !selection) return null
  const edit = draft ?? selection
  const model = catalog.models.find(item => item.id === edit.model) ?? catalog.models[0]
  const options = thinkingOptions(model)
  const off = model.reasoning_options.find(option => !option.enabled)
  const enabled = model.reasoning_options.find(option => option.id === edit.reasoning)?.enabled === true
  const changed = edit.model !== selection.model || edit.reasoning !== selection.reasoning
  function shownEffort() {
    if (options.some(option => option.id === edit.reasoning)) return edit.reasoning
    const remembered = lastEffort.current[model.id]
    if (remembered && options.some(option => option.id === remembered)) return remembered
    return options.some(option => option.id === model.default_choice) ? model.default_choice : options[0].id
  }
  function changeReasoning(reasoning: string) {
    if (options.some(option => option.id === reasoning)) lastEffort.current[model.id] = reasoning
    else if (options.some(option => option.id === edit.reasoning)) lastEffort.current[model.id] = edit.reasoning
    setDraft({...edit, reasoning}); setError(null)
  }
  async function apply() {
    if (saving) return
    const id = ++request.current
    setSaving(true); setError(null)
    try {
      const result = sessionId ? await sessionApi.setModel(sessionId, edit) : edit
      if (id !== request.current) return
      setPicked(result); setDraft(result); setNotice(null)
    } catch (e) {if (id === request.current) setError(e instanceof Error ? e.message : '模型没有切换')}
    finally {if (id === request.current) setSaving(false)}
  }
  return <Popover open={open} onOpenChange={value => {
    if (saving) return
    setOpen(value)
    if (value) {setDraft(selection); setError(null); setNotice(null)}
  }}>
    <PopoverTrigger asChild><button type="button" aria-label={`模型与思考：${selection.model}，${selection.reasoning}`}
      className="inline-flex h-7 max-w-[14rem] items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
      <span className="truncate font-mono">{selection.model}</span><span>{selection.reasoning}</span><ChevronDown className="size-3 shrink-0"/>
    </button></PopoverTrigger>
    <PopoverContent side="top" align="end" className="w-80 max-w-[calc(100vw-2rem)] p-3" onEscapeKeyDown={e => {if (saving) e.preventDefault()}}>
      <p className="mb-2 text-meta font-medium">模型</p>
      <div role="radiogroup" aria-label="模型">{catalog.models.map(item => <button key={item.id} role="radio" aria-checked={edit.model === item.id} type="button" disabled={saving}
        onClick={() => {const next = selectModel(edit, model, item); setDraft(next); setError(null); setNotice(next.reasoning !== edit.reasoning ? `已改用默认 ${next.reasoning}` : null)}}
        className={cn('flex min-h-10 w-full items-center justify-between rounded-md px-2 text-left font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring', edit.model === item.id ? 'bg-muted font-medium' : 'hover:bg-muted/50')}>
        {item.id}{edit.model === item.id && <Check className="size-4 text-signal" aria-hidden/>}
      </button>)}</div>
      {notice && <p className="mt-2 text-xs text-muted-foreground" role="status">{notice}</p>}
      {model.reasoning_options.length > 0 && <div className="mt-3 border-t pt-3">
        <div className="flex items-center justify-between"><label htmlFor="model-thinking" className="text-meta font-medium">思考{enabled ? ` · ${edit.reasoning}` : '已关闭'}</label>
          {off && options.length > 0 && <Switch id="model-thinking" checked={enabled} disabled={saving} onCheckedChange={value => changeReasoning(value ? lastEffort.current[model.id] || (options.some(o => o.id === model.default_choice) ? model.default_choice : options[0].id) : off.id)}/>}
        </div>
        {options.length > 1 && model.reasoning_ordered ? <EffortSlider options={options} value={shownEffort()} disabled={!enabled || saving} onChange={changeReasoning}/> : options.length > 1 ? <select aria-label="思考选项" disabled={!enabled || saving} value={edit.reasoning} onChange={e => changeReasoning(e.target.value)} className="mt-2 w-full rounded border bg-background p-2 text-sm">{options.map(option => <option key={option.id} value={option.id}>{option.id}</option>)}</select> : null}
      </div>}
      {runModel && <p className="mt-2 text-xs text-muted-foreground">本次运行 {runModel}{runReasoning ? ` · ${runReasoning}` : ''}</p>}
      {error && <p role="alert" className="mt-2 text-xs text-state-failed">{error}</p>}
      <div className="mt-3 flex justify-end gap-2"><Button type="button" variant="ghost" size="sm" disabled={saving} onClick={() => {setDraft(null); setOpen(false)}}>{changed ? '取消' : '关闭'}</Button>
        <Button type="button" size="sm" disabled={!changed || saving} onClick={() => void apply()}>{saving ? '正在应用' : '应用'}</Button></div>
    </PopoverContent>
  </Popover>
}
