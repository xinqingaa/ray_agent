import {useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react'
import {Check, ChevronDown} from '@/components/ui/icons'
import {toast} from 'sonner'
import {MODEL_CONNECTIONS_CHANGED} from '@/lib/api/model-connections'
import {configApi} from '@/lib/api/config'
import {sessionApi} from '@/lib/api/session'
import type {ModelCatalog} from '@/lib/api/types'
import {Popover, PopoverContent, PopoverTrigger} from '@/components/ui/popover'
import {Switch} from '@/components/ui/switch'
import {LevelSlider} from '@/components/ui/level-slider'
import {Select} from '@/components/ui/select'
import {VendorIcon} from '@/components/vendor-icon'
import {cn} from '@/lib/utils'
import {contextLabel, modelFacts, modelsForVendor, reasoningLabel, selectModel, thinkingOptions, vendorOf, vendorTabs, type CatalogModel, type ModelSelection} from '@/lib/model-selection'
import {useDeveloperMode} from '@/hooks/use-developer-mode'
import {isDesktop, openModelConfig} from '@/lib/platform'
import {MODEL_PREFERENCE_CHANGED, readModelPreference, rememberModelPreference, validModelPreference} from '@/lib/model-preference'
export type {ModelSelection} from '@/lib/model-selection'

function usableCatalog(data: ModelCatalog | null | undefined): ModelCatalog | null {
  return data?.provider && data.models.length ? data : null
}

export function ModelPicker({sessionId, savedModel, savedReasoning, onSelection, catalog: providedCatalog, loadError}: {
  sessionId?: string | null; savedModel?: string | null; savedReasoning?: string | null;
  runModel?: string | null; runReasoning?: string | null; onSelection: (selection: ModelSelection | null) => void;
  catalog?: ModelCatalog; loadError?: string;
}) {
  const {visibility} = useDeveloperMode()
  const [catalog, setCatalog] = useState<ModelCatalog | null>(usableCatalog(providedCatalog))
  const [catalogError, setCatalogError] = useState<string | null>(loadError ?? null)
  const [catalogReady, setCatalogReady] = useState(Boolean(providedCatalog || loadError))
  const [catalogRevision, setCatalogRevision] = useState(0)
  useEffect(() => {
    const refresh = () => setCatalogRevision(value => value + 1)
    window.addEventListener(MODEL_CONNECTIONS_CHANGED, refresh)
    return () => window.removeEventListener(MODEL_CONNECTIONS_CHANGED, refresh)
  }, [])
  const [picked, setPicked] = useState<ModelSelection | null>(null)
  const [recent, setRecent] = useState<ModelSelection | null>(null)
  const [preferenceRead, setPreferenceRead] = useState(false)
  const [draft, setDraft] = useState<ModelSelection | null>(null)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
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
  if (scope !== sessionId) {setScope(sessionId); setPicked(null); setDraft(null); setOpen(false); setSaving(false); setError(null)}
  useEffect(() => {
    if (loadError) {setCatalog(null); setCatalogError(loadError); setCatalogReady(true); return}
    if (providedCatalog) {setCatalog(usableCatalog(providedCatalog)); setCatalogError(null); setCatalogReady(true); return}
    let cancelled = false
    configApi.getModels().then(data => {if (!cancelled) {setCatalog(usableCatalog(data)); setCatalogError(null)}})
      .catch((reason: unknown) => {if (!cancelled) setCatalogError(reason instanceof Error ? reason.message : '模型目录读取失败')})
      .finally(() => {if (!cancelled) setCatalogReady(true)})
    return () => {cancelled = true}
  }, [providedCatalog, loadError, catalogRevision])
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
  const refreshCatalog = () => {if (!providedCatalog && !loadError) setCatalogRevision(version => version + 1)}
  const openConfig = () => void openModelConfig().catch(reason => toast.error(reason instanceof Error ? reason.message : '无法打开模型配置文件'))
  const configButton = isDesktop() && <button type="button" className="shrink-0 rounded text-xs text-signal underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring"
    onClick={openConfig}>打开模型配置</button>
  if (catalogReady && !catalog) {
    return <Popover open={open} onOpenChange={next => {setOpen(next); if (next) refreshCatalog()}}>
      <PopoverTrigger asChild><button type="button" aria-label={`模型与思考：${catalogError ? '目录读取失败' : '未配置模型'}`}
        className="model-picker-trigger inline-flex h-8 min-w-0 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
        <span className="truncate">{catalogError ? '模型目录不可用' : '未配置模型'}</span><ChevronDown className="size-3 shrink-0"/>
      </button></PopoverTrigger>
      <PopoverContent side="top" align="end" className="w-80 max-w-[calc(100vw-2rem)] p-3">
        <p role={catalogError ? 'alert' : undefined} className={cn('mb-2 text-xs', catalogError ? 'text-state-failed' : 'text-muted-foreground')}>
          {catalogError ?? '在模型配置中填入提供商的连接信息和模型名称。'}
        </p>
        {configButton}
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
  const groups = vendorTabs(catalog.models).map(vendor => ({...vendor, models: modelsForVendor(catalog.models, vendor.id)}))
  const listed = groups.flatMap(group => group.models)
  const triggerVendor = vendorOf(selection.model, catalog.models)
  function applyModel(target: CatalogModel) {
    const next = selectModel(edit, model, target)
    setDraft(next)
    setError(null)
    setNotice(next.reasoning !== edit.reasoning ? '已改用该模型默认档' : null)
  }
  function row(item: CatalogModel) {
    const selected = edit.model === item.id
    return <button key={item.id} role="radio" aria-checked={selected} type="button" disabled={saving} title={modelFacts(item)}
      tabIndex={selected || (!listed.some(candidate => candidate.id === edit.model) && listed[0] === item) ? 0 : -1}
      onKeyDown={event => {
        if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
        event.preventDefault()
        const index = listed.indexOf(item)
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? listed.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : listed.length - 1)) % listed.length
        event.currentTarget.closest('[role="radiogroup"]')?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus()
        applyModel(listed[next])
      }}
      onClick={() => applyModel(item)}
      className={cn('flex h-8 w-full items-center gap-2 rounded-md pl-7 pr-2 text-left text-meta outline-none focus-visible:ring-2 focus-visible:ring-ring', selected ? 'bg-signal-soft/60' : 'hover:bg-muted')}>
      <span className={cn('min-w-0 flex-1 truncate', selected ? 'font-medium text-foreground' : 'text-foreground/85')}>{item.id}</span>
      <span className={cn('shrink-0 text-xs tabular-nums', item.connection_issue ? 'text-state-failed' : 'text-faint')} title={modelFacts(item)}>
        {item.connection_issue ?? contextLabel(item.context_window)}
      </span>
      <Check className={cn('size-3.5 shrink-0 text-signal', !selected && 'invisible')} aria-hidden/>
    </button>
  }
  const defaultEffort = model && options.some(option => option.id === model.default_choice) ? model.default_choice : options[0]?.id
  const status = error ?? (saving ? '正在保存' : notice ?? (enabled ? null : '已关闭'))
  return <Popover open={open} onOpenChange={value => {
    if (saving) return
    if (value) {setOpen(true); setDraft(selection); setError(null); setNotice(null); refreshCatalog(); return}
    return commitClose()
  }}>
    <PopoverTrigger asChild><button type="button" aria-label={inheritSession ? '模型与思考：沿用对话设置' : `模型与思考：${selection.model}，思考${reasoningLabel(selection.reasoning)}`}
      className="model-picker-trigger group/trigger inline-flex h-8 min-w-0 max-w-[15rem] items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-muted data-[state=open]:text-foreground">
      {!inheritSession && triggerVendor && <VendorIcon vendor={triggerVendor} className="size-3 shrink-0"/>}
      <span className="truncate font-medium" title={inheritSession ? '沿用对话设置' : selection.model}>{inheritSession ? '沿用对话设置' : selection.model}</span>
      {!inheritSession && visibility.reasoningInTrigger && <span data-trigger-effort className="shrink-0 text-faint group-hover/trigger:text-muted-foreground">{reasoningLabel(selection.reasoning)}</span>}
      <ChevronDown className="size-3 shrink-0 transition-transform duration-150 group-data-[state=open]/trigger:rotate-180 motion-reduce:transition-none"/>
    </button></PopoverTrigger>
    <PopoverContent side="top" align="end" className="max-h-(--radix-popover-content-available-height) w-80 max-w-[calc(100vw-2rem)] overflow-y-auto p-1.5" onEscapeKeyDown={e => {if (saving) e.preventDefault()}} onInteractOutside={e => {if (saving) e.preventDefault()}}>
      <div role="radiogroup" aria-label="模型" className="space-y-1">{groups.map(group => <div key={group.id} role="group" aria-label={group.label}>
        <div aria-hidden className="flex h-7 items-center gap-2 px-2 text-xs font-medium text-muted-foreground">
          <VendorIcon vendor={group.id}/>{group.label}
        </div>
        {group.models.map(row)}
      </div>)}</div>
      {(model?.connection_issue || !groups.some(group => group.id === 'deepseek') || !groups.some(group => group.id === 'openai')) && <div className="mx-2 mt-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span>{model?.connection_issue ?? (!groups.some(group => group.id === 'deepseek') ? '当前配置未提供 DeepSeek。' : '当前配置未提供 OpenAI。')}</span>{configButton}
      </div>}
      {catalogError && <p role="alert" className="mx-2 mt-1 text-xs text-state-failed">{catalogError}</p>}
      {!model && <p role="alert" className="mx-2 mt-2 text-xs text-state-failed">所选模型暂不可用，请选择其他模型</p>}
      {model && model.reasoning_options.length > 0 && <div className="mt-1.5 border-t px-2 pt-2">
        <div className="flex h-7 items-center gap-2">
          <label htmlFor="model-thinking" className="shrink-0 text-meta font-medium">思考强度</label>
          {enabled && options.length > 0 && <span className="shrink-0 text-meta font-medium text-signal">{reasoningLabel(effort)}</span>}
          <span className="ml-auto flex min-w-0 items-center gap-2">
            <span role={error ? 'alert' : 'status'} title={status ?? undefined}
              className={cn('min-w-0 truncate text-xs', error ? 'text-state-failed' : notice || saving ? 'text-muted-foreground' : 'text-faint')}>{status}</span>
            <Switch id="model-thinking" aria-label="开启思考" title={off ? undefined : '该模型不能关闭思考'} checked={enabled} disabled={saving || !off || !options.length}
              onCheckedChange={value => off && changeReasoning(value ? lastEffort.current[model.id] || defaultEffort || off.id : off.id)}/>
          </span>
        </div>
        <div className="flex h-11 flex-col justify-center pb-1">
          {options.length > 1 && model.reasoning_ordered
            ? <LevelSlider label="思考强度" options={options} value={effort} describe={reasoningLabel} disabled={!enabled || saving} onChange={changeReasoning}/>
            : options.length > 1
              ? <Select label="思考选项" value={options.some(option => option.id === edit.reasoning) ? edit.reasoning : effort} disabled={!enabled || saving} options={options.map(option => ({...option, label: reasoningLabel(option.id)}))} onChange={changeReasoning}/>
              : <p className="text-xs text-muted-foreground">{options.length ? `该模型只有「${reasoningLabel(options[0].id)}」一档` : '该模型不支持思考'}</p>}
        </div>
      </div>}
      {!(model && model.reasoning_options.length > 0) && (saving || error) && <p role={error ? 'alert' : 'status'} className={cn('mx-2 mb-1 mt-2 text-xs', error ? 'text-state-failed' : 'text-muted-foreground')}>{error ?? '正在保存'}</p>}
    </PopoverContent>
  </Popover>
}
