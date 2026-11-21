import type {ReactNode} from 'react'
import {Input} from '@/components/ui/input'
import {Switch} from '@/components/ui/switch'
import {useDeveloperMode} from '@/hooks/use-developer-mode'
import {configApi} from '@/lib/api/config'
import type {AgentConfig} from '@/lib/api/types'
import {checkInteger, collect, FormSkeleton, LoadError, SectionHeader, type ConfigForm, type Values} from './form'
import {HostPreferenceRows} from './host-preference-rows'
import {SettingsRow} from './settings-row'
import {VoiceSettings} from './voice-settings'

export type GeneralField = 'max_iterations' | 'max_retries' | 'max_search_results' | 'standalone_execution_enabled'
export type GeneralForm = ConfigForm<AgentConfig, GeneralField>

/** 取值范围与后端 AgentConfig 的约束一致 */
const FIELDS: {field: Exclude<GeneralField, 'standalone_execution_enabled'>; label: string; hint: string; min: number; max: number}[] = [
  {
    field: 'max_iterations',
    label: '单次运行最大模型请求次数',
    hint: '一次运行里最多向模型发出的请求数，重试也计入。达到上限时运行以失败结束。',
    min: 1,
    max: 999,
  },
  {
    field: 'max_retries',
    label: '单次模型请求最多尝试次数',
    hint: '连接中断、超时或空回复时自动重试，直到达到这个次数。',
    min: 2,
    max: 9,
  },
  {
    field: 'max_search_results',
    label: '搜索结果条数',
    hint: '搜索工具每次返回给模型的最多结果数。',
    min: 2,
    max: 29,
  },
]

export const generalFormOptions = {
  name: 'general',
  load: configApi.getAgentConfig,
  save: configApi.updateAgentConfig,
  toValues: (c: AgentConfig): Values<GeneralField> => ({
    max_iterations: String(c.max_iterations ?? ''),
    max_retries: String(c.max_retries ?? ''),
    max_search_results: String(c.max_search_results ?? ''),
    standalone_execution_enabled: c.standalone_execution_enabled === true ? '1' : '0',
  }),
  fromValues: (v: Values<GeneralField>, base: AgentConfig): AgentConfig => ({
    ...base,
    max_iterations: Number(v.max_iterations),
    max_retries: Number(v.max_retries),
    max_search_results: Number(v.max_search_results),
    standalone_execution_enabled: v.standalone_execution_enabled === '1',
  }),
  validate: (v: Values<GeneralField>) =>
    collect<GeneralField>(Object.fromEntries(FIELDS.map((f) => [f.field, checkInteger(v[f.field], f.min, f.max)]))),
}

/**
 * 通用分区：开发者模式（由外层传入）、桌面宿主偏好（通知、退出确认）、语音转文字、独立对话的本机执行，以及开发者模式下的循环上限。
 * 本机执行与上限是草稿，经底部浮出条保存。
 */
export function GeneralSection({form, children}: {form: GeneralForm; children?: ReactNode}) {
  const {visibility} = useDeveloperMode()
  const values = form.values
  const showLimits = visibility.executionSettings
  return (
    <section aria-labelledby="settings-general-title">
      <SectionHeader id="settings-general-title" title="通用"/>
      <div className="divide-y divide-border/70">
        {children}
        <HostPreferenceRows/>
        <VoiceSettings/>
        {form.load.phase === 'loading' && <div className="py-4"><FormSkeleton rows={showLimits ? 4 : 1}/></div>}
        {form.load.phase === 'error' && <div className="py-5"><LoadError message={form.load.message} onRetry={form.reload}/></div>}
        {form.load.phase === 'ready' && values && (
          <form
            noValidate
            className="divide-y divide-border/70"
            onSubmit={(e) => {
              e.preventDefault()
              void form.save()
            }}
          >
            {/* 隐藏的提交按钮让回车在本分区内提交草稿；可见的保存入口在底部浮出条。 */}
            <button type="submit" className="hidden" tabIndex={-1} aria-hidden>保存</button>
            <SettingsRow
              id="standalone-execution"
              htmlFor={form.fieldId('standalone_execution_enabled')}
              title="独立对话启用本机执行"
              description="默认关闭。打开后，独立对话可在会话工作目录中使用 Shell 与脚本；工作区会话由各自工作区开关控制。"
              control={
                <Switch
                  id={form.fieldId('standalone_execution_enabled')}
                  aria-labelledby="standalone-execution-title"
                  checked={values.standalone_execution_enabled === '1'}
                  onCheckedChange={(checked) => form.setValue('standalone_execution_enabled', checked ? '1' : '0')}
                  disabled={form.saving}
                />
              }
            />
            {showLimits && FIELDS.map(({field, label, hint, min, max}) => (
              <SettingsRow
                key={field}
                id={form.fieldId(field)}
                htmlFor={form.fieldId(field)}
                title={label}
                description={<>{hint}<span className="ml-1 tabular-nums">范围 {min}–{max}。</span></>}
                error={form.visibleErrors[field]}
                control={
                  <Input
                    id={form.fieldId(field)}
                    name={field}
                    inputMode="numeric"
                    autoComplete="off"
                    className="w-24 tabular-nums"
                    aria-invalid={form.visibleErrors[field] ? true : undefined}
                    value={values[field]}
                    onChange={(e) => form.setValue(field, e.target.value)}
                    disabled={form.saving}
                  />
                }
              />
            ))}
          </form>
        )}
      </div>
    </section>
  )
}
