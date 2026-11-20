import {Activity, AlertTriangle, BookOpen, ChevronRight, FolderOpen, Globe, Package, ShieldCheck, SlidersHorizontal, X, type UiIcon, Bot, Cable, Palette} from '@/components/ui/icons'
import {useEffect, useRef, useState} from 'react'
import {Button} from '@/components/ui/button'
import {IconAction} from '@/components/ui/icon-action'
import {useRouter} from '@/lib/navigation'
import {useLocation} from 'react-router'
import {parseWorkspaceRoute} from '@/lib/workspace-route'
import {cn} from '@/lib/utils'
import {useConfigForm, useUnsavedGuard} from './form'
import {GeneralSection, generalFormOptions} from './general-section'
import {LlmSection, llmFormOptions} from './llm-section'
import {McpSection} from './mcp-section'
import {A2aSection} from './a2a-section'
import {ToolPolicySection, useToolPolicyForm} from './tool-policy-section'
import {skillsHref} from '@/lib/skill-route'
import {AppearanceSection} from './appearance-section'
import {DataSection} from './data-section'
import {WorkspaceSection} from './workspace-section'
import {useDeveloperMode} from '@/hooks/use-developer-mode'
import {Switch} from '@/components/ui/switch'
import {UsageSection} from './usage-section'
import {VoiceSettings} from './voice-settings'

type SectionKey = 'general' | 'workspace' | 'appearance' | 'llm' | 'mcp' | 'a2a' | 'tool-policy' | 'data' | 'usage'

const SECTIONS: {key: SectionKey; label: string; icon: UiIcon}[] = [
  {key: 'general', label: '通用', icon: SlidersHorizontal},
  {key: 'workspace', label: '工作区', icon: FolderOpen},
  {key: 'appearance', label: '外观', icon: Palette},
  {key: 'llm', label: '模型提供商', icon: Bot},
  {key: 'usage', label: '用量', icon: Activity},
  {key: 'mcp', label: 'MCP 服务器', icon: Cable},
  {key: 'a2a', label: '远程 Agent', icon: Globe},
  {key: 'tool-policy', label: '工具策略', icon: ShieldCheck},
  {key: 'data', label: '数据管理', icon: SlidersHorizontal},
]

/** 设置页：左侧切换分区；表单草稿保存在这里，切换分区不丢失 */
export function SettingsView({onClose, onDirtyChange, onNavigate, closeBlocked, onLeaveBlocked}: {
  onClose?: () => void
  onDirtyChange?: (dirty: boolean) => void
  onNavigate?: () => void | boolean
  closeBlocked?: boolean
  onLeaveBlocked?: () => void
} = {}) {
  const router = useRouter()
  const location = useLocation()
  const {workspaceId} = parseWorkspaceRoute(location.pathname)
  const skillWorkspace = location.pathname === '/skills' ? new URLSearchParams(location.search).get('workspace') : workspaceId
  const {enabled, setEnabled, visibility} = useDeveloperMode()
  const [selectedSection, setActive] = useState<SectionKey>('general')
  const scroll = useRef<HTMLDivElement>(null)
  const active = selectedSection
  const general = useConfigForm(generalFormOptions)
  const llm = useConfigForm(llmFormOptions)
  const toolPolicy = useToolPolicyForm()
  const dirty: Partial<Record<SectionKey, boolean>> = {general: general.dirty, llm: llm.dirty, 'tool-policy': toolPolicy.dirty}
  const hasUnsavedChanges = general.dirty || llm.dirty || toolPolicy.dirty
  const firstDirty = SECTIONS.find(section => dirty[section.key])
  useUnsavedGuard(hasUnsavedChanges, onLeaveBlocked)
  useEffect(() => {onDirtyChange?.(hasUnsavedChanges)}, [hasUnsavedChanges, onDirtyChange])
  useEffect(() => {if (scroll.current) scroll.current.scrollTop = 0}, [active])
  const openPage = (href: string, state?: unknown) => {
    if (hasUnsavedChanges) {
      onLeaveBlocked?.()
      return
    }
    if (onNavigate?.() !== false) router.push(href, state)
  }

  return (
    <div className="@container/settings relative h-full min-h-0 w-full bg-background">
      <h1 className="sr-only">设置</h1>
      {onClose && <IconAction label="关闭设置" onClick={onClose} className="absolute top-3 right-3 z-10 bg-background text-muted-foreground">
        <X aria-hidden/>
      </IconAction>}
      <div className="flex h-full min-h-0 flex-col @3xl/settings:flex-row">
        <nav aria-label="设置分区" className="shrink-0 overflow-x-auto border-b bg-muted/55 px-3 py-2 pr-12 @3xl/settings:w-[210px] @3xl/settings:overflow-y-auto @3xl/settings:border-b-0 @3xl/settings:px-2.5 @3xl/settings:py-4">
          <ul className="flex gap-1 @3xl/settings:flex-col">
            {SECTIONS.map(({key, label, icon: Icon}) => {
              const shownLabel = !visibility.connectionSettings && key === 'mcp' ? '外部工具' : !visibility.connectionSettings && key === 'a2a' ? '远程协作' : key === 'tool-policy' ? '执行权限' : label
              const current = key === active
              return (
                <li key={key} className="shrink-0">
                  <button
                    type="button"
                    onClick={() => setActive(key)}
                    aria-current={current ? 'true' : undefined}
                    className={cn(
                      'relative flex w-full items-center gap-2.5 whitespace-nowrap rounded-[10px] px-3 py-2 text-left text-sm transition-colors',
                      'outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                      current
                        ? 'bg-background font-medium text-foreground shadow-sm'
                        : 'text-muted-foreground hover:bg-background/65 hover:text-foreground',
                    )}
                  >
                    <Icon className="size-4 shrink-0" aria-hidden/>
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
            <li className="ml-1 shrink-0 border-l pl-2 @3xl/settings:mt-2 @3xl/settings:ml-0 @3xl/settings:border-t @3xl/settings:border-l-0 @3xl/settings:pt-2 @3xl/settings:pl-0">
              <Button type="button" variant="ghost" className="w-full justify-start gap-2.5 rounded-[10px] px-3 text-muted-foreground"
                onClick={() => openPage(skillsHref(skillWorkspace), location.pathname === '/skills' ? location.state : {returnTo: location.pathname + location.search + location.hash})}><BookOpen/>Skill<ChevronRight className="ml-auto size-3.5" aria-hidden/></Button>
            </li>
            <li className="shrink-0">
              <Button type="button" variant="ghost" className="w-full justify-start gap-2.5 rounded-[10px] px-3 text-muted-foreground"
                onClick={() => openPage('/components')}><Package/>运行组件<ChevronRight className="ml-auto size-3.5" aria-hidden/></Button>
            </li>
          </ul>
        </nav>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div ref={scroll} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 @3xl/settings:pr-[34px] @3xl/settings:pl-[30px]">
            <div className="@container/form mx-auto w-full max-w-4xl">
              {active === 'general' && <GeneralSection form={general}>
                <div className="mb-6 flex items-center justify-between gap-4 border-b pb-5">
                  <div><label htmlFor="developer-mode" className="text-sm font-medium">开发者模式</label><p id="developer-mode-hint" className="mt-1 text-xs text-muted-foreground">{enabled && hasUnsavedChanges ? '请先保存或撤销设置修改，再关闭开发者模式。' : '显示执行细节、终端和高级配置。'}</p></div>
                  <Switch id="developer-mode" aria-describedby="developer-mode-hint" checked={enabled} disabled={enabled && hasUnsavedChanges} onCheckedChange={setEnabled}/>
                </div>
                <VoiceSettings/>
              </GeneralSection>}
              {active === 'workspace' && <WorkspaceSection/>}
              {active === 'appearance' && <AppearanceSection/>}
              {active === 'data' && <DataSection onNavigate={onNavigate} disabledReason={hasUnsavedChanges ? '请先保存或撤销设置修改，再清空数据。' : undefined}/>}
              {active === 'llm' && <LlmSection form={llm}/>}
              {active === 'usage' && <UsageSection/>}
              {active === 'mcp' && <McpSection/>}
              {active === 'a2a' && <A2aSection/>}
              {active === 'tool-policy' && <ToolPolicySection form={toolPolicy}/>}
            </div>
          </div>
          {closeBlocked && firstDirty && <div role="status" className="mx-3 mb-3 flex shrink-0 flex-wrap items-center gap-2 rounded-xl bg-state-waiting-soft px-3 py-2 text-xs text-state-waiting">
            <AlertTriangle className="size-4 shrink-0" aria-hidden/>
            <span className="flex-1">请先保存或撤销设置修改。</span>
            {!dirty[active] && <Button type="button" variant="ghost" size="xs" onClick={() => setActive(firstDirty.key)}>查看{firstDirty.label}修改</Button>}
          </div>}
        </div>
      </div>
    </div>
  )
}
