'use client'

import {CheckCircle2, KeyRound} from 'lucide-react'
import {Input} from '@/components/ui/input'
import {configApi} from '@/lib/api/config'
import type {LLMConfig} from '@/lib/api/types'
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
  save: configApi.updateLLMConfig,
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
      max_tokens: ids.length > 0 ? null : checkInteger(v.max_tokens, 0),
      context_window: ids.length > 0 ? null : checkInteger(v.context_window, 1),
    })
    for (const id of ids) {
      const temperature = checkTemperature(v[profileField(id, 'temperature')] ?? '')
      const maxTokens = checkInteger(v[profileField(id, 'max_tokens')] ?? '', 0)
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

const PROFILE_FIELDS: {part: ProfilePart; label: string; hint: string; numeric: true; width: string}[] = [
  {part: 'temperature', label: '温度', hint: '越低输出越稳定；多数提供商的取值在 0 到 2 之间。', numeric: true, width: 'w-32'},
  {part: 'max_tokens', label: '单次回复最大 tokens', hint: '每次模型请求允许生成的最多 tokens。思考开启时，实际请求不会低于该模型的建议下限。', numeric: true, width: 'w-40'},
  {part: 'context_window', label: '上下文窗口', hint: '新建对话用来判断何时压缩的上下文预算。不会超过该模型自己的窗口。', numeric: true, width: 'w-40'},
]

const FIELDS: {field: LlmField; label: string; hint: string; placeholder?: string; mono?: boolean; numeric?: boolean; width: string}[] = [
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
    hint: '越低输出越稳定；多数提供商的取值在 0 到 2 之间。',
    numeric: true,
    width: 'w-32',
  },
  {
    field: 'max_tokens',
    label: '单次回复最大 tokens',
    hint: '每次模型请求允许生成的最多 tokens。',
    numeric: true,
    width: 'w-40',
  },
  {
    field: 'context_window',
    label: '上下文窗口',
    hint: '新建对话用来判断何时压缩的上下文预算。已知模型不会超过该模型自己的窗口。',
    numeric: true,
    width: 'w-40',
  },
]

export function LlmSection({form}: {form: LlmForm}) {
  const values = form.values
  return (
    <section aria-labelledby="settings-llm-title">
      <SectionHeader
        id="settings-llm-title"
        title="模型提供商"
        description="温度、单次回复上限和上下文窗口在对话第一次运行时记下。之后修改只影响新建的对话。"
      />
      {form.load.phase === 'loading' && <FormSkeleton rows={5}/>}
      {form.load.phase === 'error' && <div className="py-5"><LoadError message={form.load.message} onRetry={form.reload}/></div>}
      {form.load.phase === 'ready' && values && (
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            void form.save()
          }}
        >
          <div className="divide-y">
            {FIELDS.slice(0, 1).map(renderField)}
            <ApiKeyStatus configured={form.config?.has_api_key === true}/>
            {profileIds(values).length > 0 ? profileIds(values).map((id) => (
              <div key={id}>
                <p className="pt-4 font-mono text-sm font-medium">{id}</p>
                <div className="divide-y">
                  {PROFILE_FIELDS.map((item) => renderField({...item, field: profileField(id, item.part)}))}
                </div>
              </div>
            )) : FIELDS.slice(1).map(renderField)}
          </div>
          <SaveBar
            dirty={form.dirty}
            saving={form.saving}
            invalid={form.invalid}
            savedAt={form.savedAt}
            saveError={form.saveError}
            onReset={form.reset}
          />
        </form>
      )}
    </section>
  )

  function renderField({field, label, hint, placeholder, mono, numeric, width}: {
    field: LlmField
    label: string
    hint: string
    placeholder?: string
    mono?: boolean
    numeric?: boolean
    width: string
  }) {
    return (
      <FormField key={field} id={form.fieldId(field)} label={label} hint={hint} error={form.visibleErrors[field]}>
        {(aria) => (
          <Input
            {...aria}
            name={field}
            inputMode={numeric ? 'decimal' : field === 'base_url' ? 'url' : undefined}
            type={field === 'base_url' ? 'url' : 'text'}
            autoComplete="off"
            spellCheck={false}
            placeholder={placeholder}
            className={cn(width, mono && 'font-mono text-[13px] md:text-[13px]', numeric && 'tabular-nums')}
            value={values?.[field] ?? ''}
            onChange={(e) => form.setValue(field, e.target.value)}
            disabled={form.saving}
          />
        )}
      </FormField>
    )
  }
}
