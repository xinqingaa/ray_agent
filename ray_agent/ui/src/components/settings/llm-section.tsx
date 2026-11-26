import {Check, ChevronRight} from '@/components/ui/icons'
import {useEffect, useState} from 'react'
import {Button} from '@/components/ui/button'
import {Collapsible, CollapsibleContent, CollapsibleTrigger, collapsibleSideChevron} from '@/components/ui/collapsible'
import {Input} from '@/components/ui/input'
import {useDeveloperMode} from '@/hooks/use-developer-mode'
import {useUsagePreferences} from '@/hooks/use-usage-preferences'
import {configApi} from '@/lib/api/config'
import type {ConnectionSource, LLMConfig, ModelCatalog, ModelSampling} from '@/lib/api/types'
import {cn} from '@/lib/utils'
import {ModelConnections} from './model-connections'
import {
  checkInteger,
  collect,
  FormSkeleton,
  LoadError,
  SectionHeader,
  type ConfigForm,
  type Values,
} from './form'
import {SettingsRow} from './settings-row'

type ProfilePart = 'temperature' | 'max_tokens' | 'context_window'
export type LlmField = 'model_name' | 'temperature' | 'max_tokens' | 'context_window' | `p:${string}:${ProfilePart}`
export type LlmForm = ConfigForm<LLMConfig, LlmField>

function profileField(id: string, part: ProfilePart): LlmField {
  return `p:${id}:${part}`
}

function profileIds(values: Values<LlmField> | null): string[] {
  if (!values) return []
  const ids: string[] = []
  for (const key of Object.keys(values)) {
    const match = /^p:(.+):temperature$/.exec(key)
    if (match) ids.push(match[1])
  }
  return ids
}

export function checkTemperature(value: string): string | null {
  const v = value.trim()
  if (v === '') return '必填'
  const n = Number(v)
  if (!Number.isFinite(n)) return '请输入数字，例如 0.7'
  if (n < 0 || n > 2) return '范围为 0–2'
  return null
}

export const llmFormOptions = {
  name: 'llm',
  load: configApi.getLLMConfig,
  save: (config: LLMConfig, fields?: LlmField[]) => {
    if (!fields) return configApi.updateLLMConfig(config)
    const patch: Partial<LLMConfig> = {}
    for (const field of fields) {
      const match = /^p:(.+):(?:temperature|max_tokens|context_window)$/.exec(field)
      if (match) patch.model_profiles = {...patch.model_profiles, [match[1]]: config.model_profiles![match[1]]}
      else Object.assign(patch, {[field]: config[field as keyof LLMConfig]})
    }
    return configApi.updateLLMConfig(patch)
  },
  toValues: (c: LLMConfig): Values<LlmField> => {
    const values: Values<LlmField> = {
      model_name: c.model_name ?? '',
      temperature: c.temperature == null ? '' : String(c.temperature),
      max_tokens: c.max_tokens == null ? '' : String(c.max_tokens),
      context_window: c.context_window == null ? '' : String(c.context_window),
    }
    for (const [id, profile] of Object.entries(c.model_profiles ?? {})) {
      values[profileField(id, 'temperature')] = String(profile.temperature)
      values[profileField(id, 'max_tokens')] = String(profile.max_tokens)
      values[profileField(id, 'context_window')] = String(profile.context_window)
    }
    return values
  },
  fromValues: (v: Values<LlmField>, base: LLMConfig): LLMConfig => {
    const profiles: NonNullable<LLMConfig['model_profiles']> = {}
    for (const id of profileIds(v)) {
      profiles[id] = {
        temperature: Number(v[profileField(id, 'temperature')]),
        max_tokens: Number(v[profileField(id, 'max_tokens')]),
        context_window: Number(v[profileField(id, 'context_window')]),
      }
    }
    return {
      ...base,
      model_name: v.model_name.trim(),
      temperature: Number(v.temperature),
      max_tokens: Number(v.max_tokens),
      context_window: Number(v.context_window),
      model_profiles: Object.keys(profiles).length > 0 ? profiles : base.model_profiles,
    }
  },
  validate: (v: Values<LlmField>) => {
    const ids = profileIds(v)
    const errors = collect<LlmField>({
      model_name: ids.length > 0 || v.model_name.trim() !== '' ? null : '必填',
      temperature: ids.length > 0 ? null : checkTemperature(v.temperature),
      max_tokens: ids.length > 0 ? null : checkInteger(v.max_tokens, 1),
      context_window: ids.length > 0 ? null : checkInteger(v.context_window, 1),
    })
    for (const id of ids) {
      const temperature = checkTemperature(v[profileField(id, 'temperature')] ?? '')
      const maxTokens = checkInteger(v[profileField(id, 'max_tokens')] ?? '', 1)
      const contextWindow = checkInteger(v[profileField(id, 'context_window')] ?? '', 1)
      if (temperature) errors[profileField(id, 'temperature')] = temperature
      if (maxTokens) errors[profileField(id, 'max_tokens')] = maxTokens
      if (contextWindow) errors[profileField(id, 'context_window')] = contextWindow
    }
    return errors
  },
}

const PROFILE_FIELDS: {part: ProfilePart; label: string; numeric: true; width: string}[] = [
  {part: 'temperature', label: '温度', numeric: true, width: 'w-32'},
  {part: 'max_tokens', label: '单次回复最大 tokens', numeric: true, width: 'w-40'},
  {part: 'context_window', label: '上下文窗口', numeric: true, width: 'w-40'},
]

const FIELDS: {field: LlmField; label: string; hint?: string; placeholder?: string; mono?: boolean; numeric?: boolean; width: string}[] = [
  {
    field: 'model_name',
    label: '模型名称',
    hint: '请求时使用的模型标识，按提供商文档填写。',
    placeholder: 'deepseek-chat',
    mono: true,
    width: 'w-full max-w-72',
  },
  {
    field: 'temperature',
    label: '温度',
    numeric: true,
    width: 'w-32',
  },
  {
    field: 'max_tokens',
    label: '单次回复最大 tokens',
    numeric: true,
    width: 'w-40',
  },
  {
    field: 'context_window',
    label: '上下文窗口',
    numeric: true,
    width: 'w-40',
  },
]

function useThinkingReserve(model: ModelCatalog['models'][number] | undefined, sampling: ModelSampling | null) {
  const [reserve, setReserve] = useState<number | null>(null)
  const usable = Boolean(model && sampling && [sampling.temperature, sampling.max_tokens, sampling.context_window].every(Number.isFinite) && sampling.max_tokens >= 1 && sampling.context_window >= 1)
  const key = usable && model && sampling ? JSON.stringify([model.id, sampling]) : null
  useEffect(() => {
    if (!key || !model) return
    let cancelled = false
    const timer = setTimeout(() => {
      const body = JSON.parse(key)[1] as ModelSampling
      configApi.previewSampling(model.id, body).then(budgets => {
        if (cancelled) return
        const choice = model.reasoning_options.find(option => option.enabled && option.id === model.default_choice) ?? model.reasoning_options.find(option => option.enabled)
        const actual = choice ? budgets[choice.id]?.max_tokens : undefined
        setReserve(typeof actual === 'number' && actual > body.max_tokens ? actual : null)
      }).catch(() => {if (!cancelled) setReserve(null)})
    }, 250)
    return () => {cancelled = true; clearTimeout(timer)}
  }, [key, model])
  return key ? reserve : null
}

function enabledDefault(spec: ModelCatalog['models'][number] | undefined) {
  if (!spec) return undefined
  return spec.reasoning_options.find(option => option.enabled && option.id === spec.default_choice)
    ?? spec.reasoning_options.find(option => option.enabled)
}

function profileCopy(part: ProfilePart, spec: ModelCatalog['models'][number] | undefined, reserve: number | null): {label: string; hint?: string} {
  if (part === 'context_window') {
    if (!spec) return {label: '应用上下文预算'}
    const hint = spec.default_context_window && spec.default_context_window !== spec.context_window
      ? `默认 ${spec.default_context_window.toLocaleString()}，模型上限 ${spec.context_window.toLocaleString()}`
      : `模型上限 ${spec.context_window.toLocaleString()}`
    return {label: '应用上下文预算', hint}
  }
  if (part === 'max_tokens') {
    const choice = enabledDefault(spec)
    return {label: '单次生成预算', hint: reserve == null || !choice ? undefined : `默认档位 ${choice.id}，开启思考时为 ${reserve.toLocaleString()}`}
  }
  if (spec?.temperature_when === 'disabled') return {label: '非思考温度', hint: '关闭思考时发送'}
  if (spec?.temperature_when === 'never') return {label: '温度', hint: '该模型不使用温度'}
  return {label: '温度'}
}

function capabilityNote(spec: ModelCatalog['models'][number] | undefined, reserve: number | null): string | null {
  if (!spec) return null
  const choice = enabledDefault(spec)
  const parts = [spec.reasoning_ordered ? '有序档位' : '无序档位']
  if (spec.reasoning_options.some(option => !option.enabled)) parts.push('关闭思考')
  if (choice && reserve != null) parts.push(`默认档位 ${choice.id}，开启思考时为 ${reserve.toLocaleString()}`)
  else if (spec.default_choice) parts.push(`默认档位 ${spec.default_choice}`)
  if (spec.temperature_when === 'disabled') parts.push(spec.temperature_max == null ? '温度在关闭思考时发送' : `温度在关闭思考时发送，范围 0–${spec.temperature_max}`)
  else if (spec.temperature_when === 'never') parts.push('该模型不使用温度')
  return parts.join('。')
}

export function LlmSection({form, editing, onEditingChange, onEditorDirtyChange}: {
  form: LlmForm
  editing: boolean
  onEditingChange: (editing: boolean) => void
  onEditorDirtyChange: (dirty: boolean) => void
}) {
  const {visibility} = useDeveloperMode()
  const voiceOn = useUsagePreferences().value?.voice === 'deepseek'
  const [selected, setSelected] = useState<string | null>(null)
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const [paramsOpen, setParamsOpen] = useState(false)
  useEffect(() => {if (form.dirty) setParamsOpen(true)}, [form.dirty])
  const [connections, setConnections] = useState<ConnectionSource | null>(null)
  const connectionKey = connections?.version ?? form.config?.connections?.version
  useEffect(() => {
    if (!visibility.providerSettings) return
    let cancelled = false
    configApi.getModels().then(value => {if (!cancelled) {setCatalog(value); setCatalogError(null)}})
      .catch(error => {if (!cancelled) setCatalogError(error instanceof Error ? error.message : '模型能力读取失败')})
    return () => {cancelled = true}
  }, [connectionKey, retry, visibility.providerSettings])
  const values = form.values
  const ids = profileIds(values)
  const current = ids.includes(selected ?? '') ? selected! : ids[0]
  const spec = catalog?.models.find(model => model.id === (current || values?.model_name.trim() || catalog.default_model || ''))
  const fields = current ? PROFILE_FIELDS.map(item => profileField(current, item.part)) : FIELDS.map(item => item.field)
  function dirtyFor(scope: LlmField[]) {
    if (!form.config || !values) return false
    const base = llmFormOptions.toValues(form.config)
    return scope.some(field => values[field] !== base[field])
  }
  const sampling = values ? {
    temperature: Number(current ? values[profileField(current, 'temperature')] : values.temperature),
    max_tokens: Number(current ? values[profileField(current, 'max_tokens')] : values.max_tokens),
    context_window: Number(current ? values[profileField(current, 'context_window')] : values.context_window),
  } : null
  const reserve = useThinkingReserve(visibility.providerSettings && !editing ? spec : undefined, sampling)
  const note = capabilityNote(spec, reserve)
  const modelDirty = dirtyFor(fields)
  const modelInvalid = fields.some(field => Boolean(form.visibleErrors[field]))
  return <section aria-labelledby={editing ? undefined : 'settings-llm-title'} aria-busy={form.refreshing || undefined}
    className={editing ? 'h-full min-h-0' : undefined}>
    {!editing && <>
      <SectionHeader id="settings-llm-title" title="模型提供商"
        description="连接保存在本机配置文件，密钥仅显示掩码。修改后，新运行使用更新的连接。"/>
      {form.load.phase === 'loading' && <FormSkeleton rows={5}/>}
      {form.load.phase === 'error' && <LoadError message={form.load.message} onRetry={form.reload}/>}
    </>}
    {form.config && <ModelConnections initial={connections ?? form.config.connections ?? null} voiceOn={voiceOn}
      onEditingChange={onEditingChange} onDirtyChange={onEditorDirtyChange} onChange={next => {
      setConnections(next)
      if (!form.dirty) form.reload()
    }}/>}
    {!editing && visibility.providerSettings && form.load.phase === 'ready' && values && <Collapsible open={paramsOpen} onOpenChange={setParamsOpen}>
      <div className="mt-6 border-t pt-4">
      <CollapsibleTrigger className="flex w-full cursor-pointer items-center gap-2 text-left text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
        <ChevronRight className={cn('size-3.5 text-faint', collapsibleSideChevron)} aria-hidden/>
        逐模型参数
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-4">
        {catalogError && <LoadError message={catalogError} onRetry={() => setRetry(n => n + 1)}/>}
        <div className="grid gap-6 @xl/form:grid-cols-[minmax(0,10rem)_minmax(0,1fr)]">
          {ids.length > 0 && <nav aria-label="正在编辑的模型">
            <p className="mb-2 text-meta text-muted-foreground">正在编辑的模型</p>
            <div className="space-y-1">{ids.map(id => <button key={id} type="button" aria-current={current === id ? 'true' : undefined}
              onClick={() => setSelected(id)} className={cn('flex min-h-11 w-full items-center justify-between gap-2 rounded-[10px] px-3 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring', current === id ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:bg-muted/60')}>
              <span className="min-w-0 break-all font-mono text-xs">{id}<span className="ml-2 text-state-waiting">{dirtyFor(PROFILE_FIELDS.map(item => profileField(id, item.part))) ? '•' : ''}</span></span>
              {current === id && <Check className="size-4 shrink-0 text-signal" aria-hidden/>}
            </button>)}</div>
          </nav>}
          <form noValidate onSubmit={e => {e.preventDefault(); void form.save(fields)}} className="min-w-0">
            <h3 className="break-all font-mono text-sm font-semibold">{current || '模型参数'}</h3>
            {note && <p className="mt-1.5 text-meta leading-5 text-muted-foreground">{note}</p>}
            {spec && <p className="mt-1.5 text-meta leading-5 text-muted-foreground">{spec.context_window.toLocaleString()} 窗口 · {spec.max_output.toLocaleString()} 生成<br/>{spec.choices.join(' / ')}</p>}
            <div className="mt-2 divide-y divide-border/70">
              {ids.length > 0 ? [...PROFILE_FIELDS].sort((a, b) => ['context_window', 'max_tokens', 'temperature'].indexOf(a.part) - ['context_window', 'max_tokens', 'temperature'].indexOf(b.part)).map(item => {
                const copy = profileCopy(item.part, spec, reserve)
                return renderRow({...item, field: profileField(current, item.part), label: copy.label, hint: copy.hint})
              }) : FIELDS.map(item => {
                if (item.field === 'temperature' || item.field === 'max_tokens' || item.field === 'context_window') {
                  const copy = profileCopy(item.field, spec, reserve)
                  return renderRow({...item, label: copy.label, hint: copy.hint ?? item.hint})
                }
                return renderRow(item)
              })}
            </div>
            <p className="mt-2 text-meta text-muted-foreground">新运行和换到此模型时使用。</p>
            <div className="mt-3 flex items-center justify-end gap-2">
              {modelDirty && <Button type="button" variant="ghost" size="sm" onClick={() => form.reset(fields)} disabled={form.saving}>撤销</Button>}
              <Button type="submit" size="sm" variant="outline" disabled={!modelDirty || modelInvalid || form.saving}>
                {current ? '保存此模型' : '保存模型参数'}
              </Button>
            </div>
          </form>
        </div>
      </CollapsibleContent>
      </div>
    </Collapsible>}
  </section>
  function renderRow({field, label, hint, placeholder, mono, numeric, width}: {
    field: LlmField; label: string; hint?: string; placeholder?: string; mono?: boolean; numeric?: boolean; width: string;
  }) {
    const error = form.visibleErrors[field]
    return <SettingsRow key={field} id={`llm-${field.replace(/:/g, '-')}`} htmlFor={form.fieldId(field)} title={label} description={hint} error={error}
      control={<Input id={form.fieldId(field)} name={field} inputMode={numeric ? 'decimal' : undefined}
        type="text" autoComplete="off" spellCheck={false} placeholder={placeholder} aria-invalid={error ? true : undefined}
        className={cn(width, mono && 'font-mono text-xs', numeric && 'tabular-nums')}
        value={values?.[field] ?? ''} onChange={e => form.setValue(field, e.target.value)} disabled={form.saving}/>}/>
  }
}
