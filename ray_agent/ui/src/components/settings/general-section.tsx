'use client'

import {Input} from '@/components/ui/input'
import {configApi} from '@/lib/api/config'
import type {AgentConfig} from '@/lib/api/types'
import {checkInteger, collect, FormField, FormSkeleton, LoadError, SaveBar, SectionHeader, type ConfigForm, type Values} from './form'

export type GeneralField = 'max_iterations' | 'max_retries' | 'max_search_results' | 'project_snapshot_retention'
export type GeneralForm = ConfigForm<AgentConfig, GeneralField>

/** 取值范围与后端 AgentConfig 的约束一致 */
const FIELDS: {field: GeneralField; label: string; hint: string; min: number; max: number}[] = [
  {field:'project_snapshot_retention',label:'项目运行前快照保留份数',hint:'保留最近1至7份运行前快照；上传前和恢复前保护另行保留。后续文件操作按该设置清理旧快照。',min:1,max:7},
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
    project_snapshot_retention: String(c.project_snapshot_retention ?? 5),
  }),
  fromValues: (v: Values<GeneralField>, base: AgentConfig): AgentConfig => ({
    ...base,
    max_iterations: Number(v.max_iterations),
    max_retries: Number(v.max_retries),
    max_search_results: Number(v.max_search_results),
    project_snapshot_retention: Number(v.project_snapshot_retention),
  }),
  validate: (v: Values<GeneralField>) =>
    collect<GeneralField>(Object.fromEntries(FIELDS.map((f) => [f.field, checkInteger(v[f.field], f.min, f.max)]))),
}

export function GeneralSection({form}: {form: GeneralForm}) {
  const values = form.values
  return (
    <section aria-labelledby="settings-general-title">
      <SectionHeader
        id="settings-general-title"
        title="通用"
        description="Agent 执行循环的上限。修改后从下一次运行开始生效，正在进行的运行不受影响。"
      />
      {form.load.phase === 'loading' && <FormSkeleton rows={3}/>}
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
            {FIELDS.map(({field, label, hint, min, max}) => (
              <FormField
                key={field}
                id={form.fieldId(field)}
                label={label}
                hint={<>{hint}<span className="ml-1 tabular-nums">范围 {min}–{max}。</span></>}
                error={form.visibleErrors[field]}
              >
                {(aria) => (
                  <Input
                    {...aria}
                    name={field}
                    inputMode="numeric"
                    autoComplete="off"
                    className="w-32 tabular-nums"
                    value={values[field]}
                    onChange={(e) => form.setValue(field, e.target.value)}
                    disabled={form.saving}
                  />
                )}
              </FormField>
            ))}
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
}
