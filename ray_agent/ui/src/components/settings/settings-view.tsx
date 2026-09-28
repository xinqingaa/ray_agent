'use client'

import {useState} from 'react'
import {cn} from '@/lib/utils'
import {useConfigForm, useUnsavedGuard} from './form'
import {GeneralSection, generalFormOptions} from './general-section'
import {LlmSection, llmFormOptions} from './llm-section'
import {McpSection} from './mcp-section'
import {A2aSection} from './a2a-section'
import {ToolPolicySection} from './tool-policy-section'

type SectionKey = 'general' | 'llm' | 'mcp' | 'a2a' | 'tool-policy'

const SECTIONS: {key: SectionKey; label: string; tag?: string}[] = [
  {key: 'general', label: '通用'},
  {key: 'llm', label: '模型提供商'},
  {key: 'mcp', label: 'MCP 服务器'},
  {key: 'a2a', label: '远程 Agent'},
  {key: 'tool-policy', label: '工具策略', tag: '未实现'},
]

/** 设置页：左侧切换分区；表单草稿保存在这里，切换分区不丢失 */
export function SettingsView() {
  const [active, setActive] = useState<SectionKey>('general')
  const general = useConfigForm(generalFormOptions)
  const llm = useConfigForm(llmFormOptions)
  const dirty: Partial<Record<SectionKey, boolean>> = {general: general.dirty, llm: llm.dirty}
  useUnsavedGuard(general.dirty || llm.dirty)

  return (
    <div className="h-full overflow-y-auto">
      <div className="@container/settings mx-auto w-full max-w-5xl px-5 pb-10 pt-6 md:px-8 md:pt-10">
        <header className="mb-6 @3xl/settings:mb-8">
          <h1 className="text-xl font-semibold">设置</h1>
          <p className="mt-1 text-meta text-muted-foreground">
            保存在 API 服务的配置文件中，对所有会话生效。
          </p>
        </header>

        <div className="@3xl/settings:grid @3xl/settings:grid-cols-[11rem_minmax(0,1fr)] @3xl/settings:gap-10">
          <nav aria-label="设置分区" className="-mx-5 mb-6 overflow-x-auto px-5 md:-mx-8 md:px-8 @3xl/settings:sticky @3xl/settings:top-10 @3xl/settings:mx-0 @3xl/settings:mb-0 @3xl/settings:self-start @3xl/settings:px-0">
            <ul className="flex gap-1 border-b @3xl/settings:flex-col @3xl/settings:border-b-0">
              {SECTIONS.map(({key, label, tag}) => {
                const current = key === active
                return (
                  <li key={key} className="shrink-0">
                    <button
                      type="button"
                      onClick={() => setActive(key)}
                      aria-current={current ? 'true' : undefined}
                      className={cn(
                        'relative flex w-full items-center gap-2 whitespace-nowrap px-3 py-2 text-left text-sm transition-colors',
                        'rounded-t-md @3xl/settings:rounded-md',
                        'outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                        current
                          ? 'font-medium text-foreground @max-3xl/settings:after:absolute @max-3xl/settings:after:inset-x-2 @max-3xl/settings:after:-bottom-px @max-3xl/settings:after:h-0.5 @max-3xl/settings:after:bg-foreground @3xl/settings:bg-muted'
                          : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                      )}
                    >
                      {label}
                      {tag && <span className="rounded-sm border px-1 text-[11px] leading-4 text-faint">{tag}</span>}
                      {dirty[key] && (
                        <>
                          <span className="ml-auto size-1.5 shrink-0 rounded-full bg-state-waiting" aria-hidden/>
                          <span className="sr-only">（有未保存的修改）</span>
                        </>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          </nav>

          <div className="@container/form min-w-0">
            {active === 'general' && <GeneralSection form={general}/>}
            {active === 'llm' && <LlmSection form={llm}/>}
            {active === 'mcp' && <McpSection/>}
            {active === 'a2a' && <A2aSection/>}
            {active === 'tool-policy' && <ToolPolicySection/>}
          </div>
        </div>
      </div>
    </div>
  )
}
