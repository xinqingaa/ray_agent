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
import {DataSection} from './data-section'
import {useDeveloperMode} from '@/hooks/use-developer-mode'
import {Switch} from '@/components/ui/switch'

type SectionKey = 'general' | 'appearance' | 'llm' | 'mcp' | 'a2a' | 'tool-policy' | 'data'

const SECTIONS: {key: SectionKey; label: string; icon: LucideIcon}[] = [
  {key: 'general', label: '通用', icon: SlidersHorizontal},
  {key: 'appearance', label: '外观', icon: Palette},
  {key: 'llm', label: '模型提供商', icon: Bot},
  {key: 'mcp', label: 'MCP 服务器', icon: Cable},
  {key: 'a2a', label: '远程 Agent', icon: Globe},
  {key: 'tool-policy', label: '工具策略', icon: ShieldCheck},
  {key: 'data', label: '数据管理', icon: SlidersHorizontal},
]

/** 设置页：左侧切换分区；表单草稿保存在这里，切换分区不丢失 */
export function SettingsView({onClose, onDirtyChange, onNavigate}: {onClose?: () => void; onDirtyChange?: (dirty: boolean) => void; onNavigate?: () => void | boolean} = {}) {
  const {enabled, setEnabled, visibility} = useDeveloperMode()
  const [selectedSection, setActive] = useState<SectionKey>('general')
  const active = selectedSection === 'llm' && !visibility.providerSettings ? 'general' : selectedSection
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
              {SECTIONS.filter(item => item.key !== 'llm' || visibility.providerSettings).map(({key, label, icon: Icon}) => {
                const shownLabel = !visibility.connectionSettings && key === 'mcp' ? '外部工具' : !visibility.connectionSettings && key === 'a2a' ? '远程协作' : key === 'tool-policy' ? '执行权限' : label
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
                      {shownLabel}
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
            {active === 'general' && <>
              <div className="mb-6 flex items-center justify-between gap-4 border-b pb-5">
                <div><label htmlFor="developer-mode" className="text-sm font-medium">开发者模式</label><p id="developer-mode-hint" className="mt-1 text-xs text-muted-foreground">{enabled && hasUnsavedChanges ? '请先保存或撤销设置修改，再关闭开发者模式。' : '显示执行细节、终端和高级配置。'}</p></div>
                <Switch id="developer-mode" aria-describedby="developer-mode-hint" checked={enabled} disabled={enabled && hasUnsavedChanges} onCheckedChange={setEnabled}/>
              </div>
              <GeneralSection form={general}/>
            </>}
            {active === 'appearance' && <AppearanceSection/>}
            {active === 'data' && <DataSection onNavigate={onNavigate} disabledReason={hasUnsavedChanges ? '请先保存或撤销设置修改，再清空数据。' : undefined}/>}
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
