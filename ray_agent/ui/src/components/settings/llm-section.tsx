'use client'

import {useEffect, useState} from 'react'
import {Check, CheckCircle2, KeyRound} from 'lucide-react'
import {Input} from '@/components/ui/input'
import {configApi} from '@/lib/api/config'
import type {LLMConfig, ModelCatalog, ModelSampling} from '@/lib/api/types'
import {cn} from '@/lib/utils'
import {
  checkHttpUrl,
  checkInteger,
  collect,
  FormField,
  FormSkeleton,
  LoadError,
  SaveBar,
  SectionHeader,
  type ConfigForm,
  type Values,
} from './form'

type ProfilePart = 'temperature' | 'max_tokens' | 'context_window'
export type LlmField = 'base_url' | 'model_name' | 'temperature' | 'max_tokens' | 'context_window' | `p:${string}:${ProfilePart}`
export type LlmForm = ConfigForm<LLMConfig, LlmField>

function profileField(id: string, part: ProfilePart): LlmField {
  return `p:${id}:${part}`
}

function profileIds(values: Values<LlmField> | null): string[] {
  if (!values) return []
  const ids: string[] = []
  for (const key of Object.keys(values)) {
    const match = /^p:([^:]+):temperature$/.exec(key)
    if (match) ids.push(match[1])
  }
  return ids
}

function checkTemperature(value: string): string | null {
  const v = value.trim()
  if (v === '') return '必填'
  const n = Number(v)
  if (!Number.isFinite(n)) return '请输入数字，例如 0.7'
  if (n < 0) return '不能小于 0'
  return null
}

export const llmFormOptions = {
  name: 'llm',
  load: configApi.getLLMConfig,
  save: (config: LLMConfig, fields?: LlmField[]) => {
    if (!fields) return configApi.updateLLMConfig(config)
    const patch: Partial<LLMConfig> = {}
    for (const field of fields) {
      const match = /^p:([^:]+):/.exec(field)
      if (match) patch.model_profiles = {...patch.model_profiles, [match[1]]: config.model_profiles![match[1]]}
      else Object.assign(patch, {[field]: config[field as keyof LLMConfig]})
    }
    return configApi.updateLLMConfig(patch)
  },
  toValues: (c: LLMConfig): Values<LlmField> => {
    const values: Values<LlmField> = {
      base_url: c.base_url ?? '',
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
      base_url: v.base_url.trim(),
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
      base_url: checkHttpUrl(v.base_url),
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

function ApiKeyStatus({configured}: {configured: boolean}) {
  return (
    <div className="grid gap-x-8 gap-y-1.5 py-4 @xl/form:grid-cols-[minmax(0,15rem)_minmax(0,28rem)]">
      <div>
        <p className="text-sm font-medium">API Key</p>
        <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
          只从 API 服务的环境变量 <code className="font-mono">LLM_API_KEY</code> 读取，页面不显示、不保存。
        </p>
      </div>
      <p
        className={cn(
          'flex h-9 items-center gap-2 text-sm',
          configured ? 'text-state-success' : 'text-state-waiting',
        )}
      >
        {configured ? <CheckCircle2 className="size-4" aria-hidden/> : <KeyRound className="size-4" aria-hidden/>}
        {configured ? '已从环境变量读取' : '未配置：在 API 服务的环境中设置 LLM_API_KEY 后重启'}
      </p>
    </div>
  )
}

const PROFILE_FIELDS: {part: ProfilePart; label: string; numeric: true; width: string}[] = [
  {part: 'temperature', label: '温度', numeric: true, width: 'w-32'},
  {part: 'max_tokens', label: '单次回复最大 tokens', numeric: true, width: 'w-40'},
  {part: 'context_window', label: '上下文窗口', numeric: true, width: 'w-40'},
]

const FIELDS: {field: LlmField; label: string; hint?: string; placeholder?: string; mono?: boolean; numeric?: boolean; width: string}[] = [
  {
    field: 'base_url',
    label: '接口地址',
    hint: 'OpenAI 兼容接口的基础地址。',
    placeholder: 'https://api.deepseek.com',
    mono: true,
    width: 'w-full',
  },
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
    if (!key || !model) {setReserve(null); return}
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
  return reserve
}

function profileCopy(part: ProfilePart, spec: ModelCatalog['models'][number] | undefined, reserve: number | null): {label: string; hint?: string} {
  if (part === 'context_window') return {label: '应用上下文预算'}
  if (part === 'max_tokens') return {label: '单次生成预算', hint: reserve == null ? undefined : `开启思考时为 ${reserve.toLocaleString()}`}
  if (spec?.temperature_when === 'disabled') {
    const off = spec.reasoning_options.find(option => !option.enabled)?.id ?? '关闭'
    return {label: '非思考温度', hint: spec.temperature_max == null ? `仅 ${off} 时使用` : `仅 ${off} 时使用 · 0–${spec.temperature_max}`}
  }
  if (spec?.temperature_when === 'never') return {label: '温度', hint: '该模型不使用温度'}
  return {label: '温度'}
}

export function LlmSection({form}: {form: LlmForm}) {
  const [selected, setSelected] = useState<string | null>(null)
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let cancelled = false
    configApi.getModels().then(value => {if (!cancelled) {setCatalog(value); setCatalogError(null)}})
      .catch(error => {if (!cancelled) setCatalogError(error instanceof Error ? error.message : '模型能力读取失败')})
    return () => {cancelled = true}
  }, [form.config?.base_url, retry])
  const values = form.values
  const ids = profileIds(values)
  const current = ids.includes(selected ?? '') ? selected! : ids[0]
  const spec = catalog?.models.find(model => model.id === current)
  const fields = current ? PROFILE_FIELDS.map(item => profileField(current, item.part)) : FIELDS.slice(1).map(item => item.field)
  function dirtyFor(scope: LlmField[]) {
    if (!form.config || !values) return false
    const base = llmFormOptions.toValues(form.config)
    return scope.some(field => values[field] !== base[field])
  }
  function saveBar(scope: LlmField[], label: string) {
    return <SaveBar dirty={dirtyFor(scope)} saving={form.saving} invalid={scope.some(field => Boolean(form.visibleErrors[field]))}
      savedAt={form.savedAt} saveError={form.saveError} onReset={() => form.reset(scope)} label={label}/>
  }
  const sampling = current && values ? {
    temperature: Number(values[profileField(current, 'temperature')]),
    max_tokens: Number(values[profileField(current, 'max_tokens')]),
    context_window: Number(values[profileField(current, 'context_window')]),
  } : null
  const reserve = useThinkingReserve(spec, sampling)
  return <section aria-labelledby="settings-llm-title">
    <SectionHeader id="settings-llm-title" title="模型提供商"/>
    {form.load.phase === 'loading' && <FormSkeleton rows={5}/>}
    {form.load.phase === 'error' && <LoadError message={form.load.message} onRetry={form.reload}/>}
    {form.load.phase === 'ready' && values && <>
      <form noValidate onSubmit={e => {e.preventDefault(); void form.save(['base_url'])}} className="py-4">
        <details className="rounded-md border px-4">
        <summary className="cursor-pointer py-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring">连接设置 <span className="ml-2 text-xs font-normal text-muted-foreground">{form.config?.base_url} · {form.config?.has_api_key ? '密钥已配置' : '未配置密钥'}</span></summary>
        {renderField(FIELDS[0])}
        <ApiKeyStatus configured={form.config?.has_api_key === true}/>
        {saveBar(['base_url'], '保存连接设置')}
        </details>
      </form>
      <div className="border-t pt-5">
        {catalogError && <LoadError message={catalogError} onRetry={() => setRetry(n => n + 1)}/>}
        <div className="grid gap-6 @xl/form:grid-cols-[minmax(0,10rem)_minmax(0,1fr)]">
          {ids.length > 0 && <nav aria-label="正在编辑的模型">
            <p className="mb-2 text-meta text-muted-foreground">正在编辑的模型</p>
            <div className="space-y-1">{ids.map(id => <button key={id} type="button" aria-current={current === id ? 'true' : undefined}
              onClick={() => setSelected(id)} className={cn('flex min-h-11 w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring', current === id ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:bg-muted/60')}>
              <span className="min-w-0 break-all font-mono text-xs">{id}<span className="ml-2 text-state-waiting">{dirtyFor(PROFILE_FIELDS.map(item => profileField(id, item.part))) ? '•' : ''}</span></span>
              {current === id && <Check className="size-4 shrink-0 text-signal" aria-hidden/>}
            </button>)}</div>
          </nav>}
          <form noValidate onSubmit={e => {e.preventDefault(); void form.save(fields)}} className="min-w-0">
            <h3 className="break-all font-mono text-base font-semibold">{current || '模型参数'}</h3>
            {spec && <p className="mt-2 text-meta text-muted-foreground">{spec.context_window.toLocaleString()} 窗口 · {spec.max_output.toLocaleString()} 生成<br/>{spec.choices.join(' / ')}</p>}
            {ids.length > 0 ? [...PROFILE_FIELDS].sort((a, b) => ['context_window', 'max_tokens', 'temperature'].indexOf(a.part) - ['context_window', 'max_tokens', 'temperature'].indexOf(b.part)).map(item => {
              const copy = profileCopy(item.part, spec, reserve)
              return renderField({...item, field: profileField(current, item.part), label: copy.label, hint: copy.hint})
            }) : FIELDS.slice(1).map(renderField)}
            <p className="mt-2 text-xs text-muted-foreground">新运行和换到此模型时使用。</p>
            {saveBar(fields, current ? '保存此模型' : '保存模型参数')}
          </form>
        </div>
      </div>
    </>}
  </section>
  function renderField({field, label, hint, placeholder, mono, numeric, width}: {
    field: LlmField; label: string; hint?: string; placeholder?: string; mono?: boolean; numeric?: boolean; width: string;
  }) {
    return <FormField key={field} id={form.fieldId(field)} label={label} hint={hint} error={form.visibleErrors[field]}>
      {aria => <Input {...aria} name={field} inputMode={numeric ? 'decimal' : field === 'base_url' ? 'url' : undefined}
        type={field === 'base_url' ? 'url' : 'text'} autoComplete="off" spellCheck={false} placeholder={placeholder}
        className={cn(width, mono && 'font-mono text-xs', numeric && 'tabular-nums')}
        value={values?.[field] ?? ''} onChange={e => form.setValue(field, e.target.value)} disabled={form.saving}/>}
    </FormField>
  }
}
