'use client'

import {useEffect, useState} from 'react'
import {Bot, Cable, Globe, Palette, ShieldCheck, SlidersHorizontal, X, type LucideIcon} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {cn} from '@/lib/utils'
import {useConfigForm, useUnsavedGuard} from './form'
import {GeneralSection, generalFormOptions} from './general-section'
import {LlmSection, llmFormOptions} from './llm-section'
import {McpSection} from './mcp-section'
import {A2aSection} from './a2a-section'
import {ToolPolicySection, useToolPolicyForm} from './tool-policy-section'
import {AppearanceSection} from './appearance-section'

type SectionKey = 'general' | 'appearance' | 'llm' | 'mcp' | 'a2a' | 'tool-policy'

const SECTIONS: {key: SectionKey; label: string; icon: LucideIcon}[] = [
  {key: 'general', label: '通用', icon: SlidersHorizontal},
  {key: 'appearance', label: '外观', icon: Palette},
  {key: 'llm', label: '模型提供商', icon: Bot},
  {key: 'mcp', label: 'MCP 服务器', icon: Cable},
  {key: 'a2a', label: '远程 Agent', icon: Globe},
  {key: 'tool-policy', label: '工具策略', icon: ShieldCheck},
]

/** 设置页：左侧切换分区；表单草稿保存在这里，切换分区不丢失 */
export function SettingsView({onClose, onDirtyChange}: {onClose?: () => void; onDirtyChange?: (dirty: boolean) => void} = {}) {
  const [active, setActive] = useState<SectionKey>('general')
  const general = useConfigForm(generalFormOptions)
  const llm = useConfigForm(llmFormOptions)
  const toolPolicy = useToolPolicyForm()
  const dirty: Partial<Record<SectionKey, boolean>> = {general: general.dirty, llm: llm.dirty, 'tool-policy': toolPolicy.dirty}
  const hasUnsavedChanges = general.dirty || llm.dirty || toolPolicy.dirty
  useUnsavedGuard(hasUnsavedChanges)
  useEffect(() => {onDirtyChange?.(hasUnsavedChanges)}, [hasUnsavedChanges, onDirtyChange])

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-background">
        <header className="flex h-16 shrink-0 items-center justify-between border-b px-5 md:px-8">
          <h1 className="text-xl font-semibold">设置</h1>
          {onClose && <Button type="button" variant="ghost" size="icon-sm" aria-label="关闭设置" title="关闭设置" onClick={onClose}><X className="size-[18px]" aria-hidden="true"/></Button>}
        </header>
      <div className="@container/settings min-h-0 flex-1">
        <div className="flex h-full min-h-0 flex-col @3xl/settings:flex-row">
          <nav aria-label="设置分区" className="shrink-0 overflow-x-auto border-b bg-sidebar px-3 py-2 @3xl/settings:w-52 @3xl/settings:overflow-y-auto @3xl/settings:border-r @3xl/settings:border-b-0 @3xl/settings:p-3">
            <ul className="flex gap-1 @3xl/settings:flex-col">
              {SECTIONS.map(({key, label, icon: Icon}) => {
                const current = key === active
                return (
                  <li key={key} className="shrink-0">
                    <button
                      type="button"
                      onClick={() => setActive(key)}
                      aria-current={current ? 'true' : undefined}
                      className={cn(
                        'relative flex w-full items-center gap-2.5 whitespace-nowrap rounded-md px-3 py-2.5 text-left text-sm transition-colors',
                        'outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                        current
                          ? 'bg-sidebar-accent font-medium text-foreground'
                          : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                      )}
                    >
                      <Icon className={cn('size-[18px] shrink-0', current ? 'text-signal' : 'text-muted-foreground')} aria-hidden="true"/>
                      {label}
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

          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain px-5 py-6 md:px-8">
          <div className="@container/form mx-auto w-full max-w-4xl">
            {active === 'general' && <GeneralSection form={general}/>}
            {active === 'appearance' && <AppearanceSection/>}
            {active === 'llm' && <LlmSection form={llm}/>}
            {active === 'mcp' && <McpSection/>}
            {active === 'a2a' && <A2aSection/>}
            {active === 'tool-policy' && <ToolPolicySection form={toolPolicy}/>}
          </div>
          </div>
        </div>
      </div>
    </div>
  )
}
