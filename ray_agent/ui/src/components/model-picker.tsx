'use client'
import {useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode} from 'react'
import {Check, ChevronDown} from 'lucide-react'
import {configApi} from '@/lib/api/config'
import {sessionApi} from '@/lib/api/session'
import type {ModelCatalog} from '@/lib/api/types'
import {Popover, PopoverContent, PopoverTrigger} from '@/components/ui/popover'
import {Switch} from '@/components/ui/switch'
import {DiscreteSlider} from '@/components/ui/slider'
import {Select} from '@/components/ui/select'
import {SegmentedControl} from '@/components/ui/segmented-control'
import {cn} from '@/lib/utils'
import {modelsForVendor, selectModel, thinkingOptions, vendorOf, vendorTabs, type CatalogModel, type ModelSelection, type VendorId} from '@/lib/model-selection'
import {useDeveloperMode} from '@/hooks/use-developer-mode'
import {MODEL_PREFERENCE_CHANGED, readModelPreference, rememberModelPreference, validModelPreference} from '@/lib/model-preference'
export type {ModelSelection} from '@/lib/model-selection'

function usableCatalog(data: ModelCatalog | null | undefined): ModelCatalog | null {
  return data?.provider && data.models.length ? data : null
}

function AnimatedBody({watch, children}: {watch: string; children: ReactNode}) {
  const outer = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const seen = useRef(false)
  useLayoutEffect(() => {
    const box = outer.current
    const content = inner.current
    if (!box || !content) return
    const next = content.offsetHeight
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!seen.current || reduce) {
      seen.current = true
      box.style.height = `${next}px`
      return
    }
    const prev = box.getBoundingClientRect().height
    if (Math.abs(prev - next) < 1) return
    box.style.height = `${prev}px`
    void box.offsetHeight
    box.style.height = `${next}px`
  }, [watch])
  return <div ref={outer} className="overflow-hidden transition-[height] duration-200 ease-out motion-reduce:transition-none"><div ref={inner}>{children}</div></div>
}

export function ModelPicker({sessionId, savedModel, savedReasoning, onSelection, catalog: providedCatalog, loadError}: {
  sessionId?: string | null; savedModel?: string | null; savedReasoning?: string | null;
  runModel?: string | null; runReasoning?: string | null; onSelection: (selection: ModelSelection | null) => void;
  catalog?: ModelCatalog; loadError?: string;
}) {
  const {visibility} = useDeveloperMode()
  const [catalog, setCatalog] = useState<ModelCatalog | null>(usableCatalog(providedCatalog))
  const [catalogError, setCatalogError] = useState<string | null>(loadError ?? null)
  const [picked, setPicked] = useState<ModelSelection | null>(null)
  const [recent, setRecent] = useState<ModelSelection | null>(null)
  const [preferenceRead, setPreferenceRead] = useState(false)
  const [draft, setDraft] = useState<ModelSelection | null>(null)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [vendor, setVendor] = useState<VendorId | null>(null)
  const [scope, setScope] = useState(sessionId)
  const request = useRef(0)
  const lastEffort = useRef<Record<string, string>>({})
  useLayoutEffect(() => {
    const refresh = () => setRecent(readModelPreference())
    refresh()
    setPreferenceRead(true)
    window.addEventListener('storage', refresh)
    window.addEventListener(MODEL_PREFERENCE_CHANGED, refresh)
    return () => {
      window.removeEventListener('storage', refresh)
      window.removeEventListener(MODEL_PREFERENCE_CHANGED, refresh)
    }
  }, [])
  if (scope !== sessionId) {setScope(sessionId); setPicked(null); setDraft(null); setVendor(null); setOpen(false); setSaving(false); setError(null)}
  useEffect(() => {
    if (loadError) {setCatalog(null); setCatalogError(loadError); return}
    if (providedCatalog) {setCatalog(usableCatalog(providedCatalog)); setCatalogError(null); return}
    let cancelled = false
    configApi.getModels().then(data => {if (!cancelled) {setCatalog(usableCatalog(data)); setCatalogError(null)}})
      .catch((reason: unknown) => {if (!cancelled) {setCatalog(null); setCatalogError(reason instanceof Error ? reason.message : '模型目录读取失败')}})
    return () => {cancelled = true}
  }, [providedCatalog, loadError])
  useEffect(() => {request.current += 1; return () => {request.current += 1}}, [sessionId])
  const selection = useMemo(() => {
    if (picked) return picked
    if (!catalog) return null
    if (savedModel) return {
      model: savedModel,
      reasoning: savedReasoning || catalog.models.find(item => item.id === savedModel)?.default_choice || '',
    }
    // 已有会话缺少选择时也不能读全局偏好；目录默认只用于菜单展示。
    if (sessionId) return validModelPreference(null, catalog)
    // 本地记录读完之前不发出目录默认值，避免新对话把 deepseek-flash / high 写回去。
    if (!preferenceRead) return null
    return validModelPreference(recent, catalog)
  }, [picked, catalog, savedModel, savedReasoning, recent, preferenceRead, sessionId])
  const inheritSession = !!sessionId && !picked && !(savedModel && savedReasoning)
  // 缺失字段交给服务端解析，避免发送目录默认值覆盖旧会话，或沿用上个会话的选择。
  useEffect(() => {onSelection(inheritSession ? null : selection)}, [onSelection, selection, inheritSession])
  if (catalogError && !catalog) {
    return <Popover>
      <PopoverTrigger asChild><button type="button" aria-label={`模型目录不可用：${catalogError}`}
        className="inline-flex h-8 max-w-[14rem] items-center gap-1 rounded-md px-2 text-xs text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
        <span className="truncate">模型目录不可用</span><ChevronDown className="size-3 shrink-0"/>
      </button></PopoverTrigger>
      <PopoverContent side="top" align="end" className="w-80 max-w-[calc(100vw-2rem)] p-3">
        <p role="alert" className="text-xs text-state-failed">{catalogError}</p>
      </PopoverContent>
    </Popover>
  }
  if (!catalog || !selection) return null
  const edit = draft ?? selection
  const model = catalog.models.find(item => item.id === edit.model)
  const options = model ? thinkingOptions(model) : []
  const off = model?.reasoning_options.find(option => !option.enabled)
  const enabled = model?.reasoning_options.find(option => option.id === edit.reasoning)?.enabled === true
  const changed = edit.model !== selection.model || edit.reasoning !== selection.reasoning
  function shownEffort() {
    if (options.some(option => option.id === edit.reasoning)) return edit.reasoning
    const remembered = model ? lastEffort.current[model.id] : null
    if (remembered && options.some(option => option.id === remembered)) return remembered
    return model && options.some(option => option.id === model.default_choice) ? model.default_choice : options[0]?.id ?? ''
  }
  function changeReasoning(reasoning: string) {
    if (!model) return
    if (options.some(option => option.id === reasoning)) lastEffort.current[model.id] = reasoning
    else if (options.some(option => option.id === edit.reasoning)) lastEffort.current[model.id] = edit.reasoning
    setDraft({...edit, reasoning}); setError(null)
  }
  async function commitClose() {
    if (!changed) {setDraft(null); setNotice(null); setError(null); setOpen(false); return}
    const id = ++request.current
    setSaving(true); setError(null)
    try {
      const result = sessionId ? await sessionApi.setModel(sessionId, edit) : edit
      if (id !== request.current) return
      rememberModelPreference(result)
      setPicked(result); setDraft(null); setNotice(null); setOpen(false)
    } catch (e) {if (id === request.current) setError(e instanceof Error ? e.message : '模型没有切换')}
    finally {if (id === request.current) setSaving(false)}
  }
  const effort = shownEffort()
  const catalogModels = catalog.models
  const tabs = vendorTabs(catalog.models)
  const activeVendor = tabs.find(item => item.id === vendor)?.id ?? vendorOf(edit.model, catalog.models) ?? tabs[0]?.id ?? null
  const listed = activeVendor ? modelsForVendor(catalog.models, activeVendor) : catalog.models
  function applyModel(target: CatalogModel) {
    const next = selectModel(edit, model, target)
    setDraft(next)
    setError(null)
    setNotice(next.reasoning !== edit.reasoning ? `已改用默认 ${next.reasoning}` : null)
  }
  function changeVendor(next: VendorId) {
    if (saving || next === activeVendor) return
    setVendor(next)
    const first = modelsForVendor(catalogModels, next)[0]
    if (first) applyModel(first)
  }
  return <Popover open={open} onOpenChange={value => {
    if (saving) return
    if (value) {setOpen(true); setDraft(selection); setVendor(vendorOf(selection.model, catalog.models)); setError(null); setNotice(null); return}
    return commitClose()
  }}>
    <PopoverTrigger asChild><button type="button" aria-label={inheritSession ? '模型与思考：沿用对话设置' : `模型与思考：${selection.model}，${selection.reasoning}`}
      className="inline-flex h-8 max-w-[14rem] items-center gap-1 rounded-md px-2 text-xs text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
      <span className="truncate font-mono" title={inheritSession ? '沿用对话设置' : selection.model}>{inheritSession ? '沿用对话设置' : selection.model}</span>{!inheritSession && visibility.reasoningInTrigger && <span>{selection.reasoning}</span>}<ChevronDown className="size-3 shrink-0"/>
    </button></PopoverTrigger>
    <PopoverContent side="top" align="end" className="w-80 max-w-[calc(100vw-2rem)] p-3" onEscapeKeyDown={e => {if (saving) e.preventDefault()}} onInteractOutside={e => {if (saving) e.preventDefault()}}>
      {tabs.length > 1 && activeVendor && <SegmentedControl className="mb-2 w-full" value={activeVendor} onValueChange={changeVendor} label="模型厂商" options={tabs.map(item => ({value: item.id, label: item.label}))}/>}
      <AnimatedBody watch={[activeVendor, edit.model, edit.reasoning, notice, error, saving, listed.map(item => item.id).join('|')].join('\n')}>
      <div role="radiogroup" aria-label="模型">{listed.map(item => <button key={item.id} role="radio" aria-checked={edit.model === item.id} type="button" disabled={saving} title={item.id}
        tabIndex={edit.model === item.id || (!listed.some(candidate => candidate.id === edit.model) && listed[0] === item) ? 0 : -1}
        onKeyDown={event => {
          if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
          event.preventDefault()
          const index = listed.indexOf(item)
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? listed.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : listed.length - 1)) % listed.length
          event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus()
          applyModel(listed[next])
        }}
        onClick={() => applyModel(item)}
        className={cn('flex min-h-10 w-full items-center justify-between rounded-md px-2 text-left font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring', edit.model === item.id ? 'bg-muted font-medium' : 'hover:bg-muted/50')}>
        <span className="truncate">{item.id}</span>{edit.model === item.id && <Check className="size-4 text-signal" aria-hidden/>}
      </button>)}</div>
      {!model && <p role="alert" className="mt-2 text-xs text-state-failed">所选模型暂不可用，请选择其他模型</p>}
      {model?.vendor === activeVendor && notice && <p className="mt-2 text-xs text-muted-foreground" role="status">{notice}</p>}
      {model && model.vendor === activeVendor && model.reasoning_options.length > 0 && <div className="mt-3 border-t pt-3">
        <div className="flex items-center justify-between"><label htmlFor="model-thinking" className="text-meta font-medium">思考强度 {enabled ? ` · ${edit.reasoning}` : '已关闭'}</label>
          {off && options.length > 0 && <Switch id="model-thinking" checked={enabled} disabled={saving} onCheckedChange={value => changeReasoning(value ? lastEffort.current[model.id] || (options.some(o => o.id === model.default_choice) ? model.default_choice : options[0].id) : off.id)}/>}
        </div>
        {options.length > 1 && model.reasoning_ordered
          ? <DiscreteSlider options={options} value={effort} disabled={!enabled || saving} onChange={changeReasoning}/>
          : options.length > 1
            ? <Select label="思考选项" value={options.some(option => option.id === edit.reasoning) ? edit.reasoning : effort} disabled={!enabled || saving} options={options} onChange={changeReasoning}/>
            : null}
      </div>}
      {saving && <p className="mt-2 text-xs text-muted-foreground" role="status">正在保存</p>}
      {error && <p role="alert" className="mt-2 text-xs text-state-failed">{error}</p>}
      </AnimatedBody>
    </PopoverContent>
  </Popover>
}
