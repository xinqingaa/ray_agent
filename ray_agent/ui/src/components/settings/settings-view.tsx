import {Activity, BookOpen, ChevronRight, Folder, Globe, Inbox, Package, Settings, ShieldCheck, Sparkles, Sun, X, type UiIcon} from '@/components/ui/icons'
import {useEffect, useRef, useState} from 'react'
import {toast} from 'sonner'
import {Button} from '@/components/ui/button'
import {IconAction} from '@/components/ui/icon-action'
import {useRouter} from '@/lib/navigation'
import {useLocation} from 'react-router'
import {parseWorkspaceRoute} from '@/lib/workspace-route'
import {cn} from '@/lib/utils'
import {useConfigForm, useUnsavedGuard, SettingsSaveBar} from './form'
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
import {SettingsRow} from './settings-row'
import type {SettingsSectionKey} from '@/lib/settings-navigation'

type SectionKey = SettingsSectionKey

const SECTIONS: {key: SectionKey; label: string; icon: UiIcon}[] = [
  {key: 'general', label: '通用', icon: Settings},
  {key: 'workspace', label: '工作区', icon: Folder},
  {key: 'appearance', label: '外观', icon: Sun},
  {key: 'llm', label: '模型提供商', icon: Sparkles},
  {key: 'usage', label: '用量', icon: Activity},
  {key: 'tool-policy', label: '工具策略', icon: ShieldCheck},
  {key: 'mcp', label: 'MCP 服务器', icon: Package},
  {key: 'a2a', label: '远程 Agent', icon: Globe},
  {key: 'data', label: '数据管理', icon: Inbox},
]

type FormState = {dirty: boolean; saving: boolean; invalid: boolean; saveError: string | null; save: () => Promise<void>; reset: () => void}

/** 设置页：左侧切换分区；表单草稿保存在这里，切换分区不丢失。保存只通过底部浮出条进行。 */
export function SettingsView({onClose, onDirtyChange, onNavigate, closeAttempt, onLeaveBlocked, initialSection}: {
  onClose?: () => void
  onDirtyChange?: (dirty: boolean) => void
  onNavigate?: () => void | boolean
  /** 每次关闭或离开被拦时递增，用于重新播放保存条的抖动提示 */
  closeAttempt?: number
  onLeaveBlocked?: () => void
  initialSection?: SectionKey
} = {}) {
  const router = useRouter()
  const location = useLocation()
  const {workspaceId} = parseWorkspaceRoute(location.pathname)
  const skillWorkspace = location.pathname === '/skills' ? new URLSearchParams(location.search).get('workspace') : workspaceId
  const {enabled, setEnabled} = useDeveloperMode()
  const [selectedSection, setActive] = useState<SectionKey>(initialSection ?? 'general')
  const scroll = useRef<HTMLDivElement>(null)
  const active = selectedSection
  const general = useConfigForm(generalFormOptions)
  const llm = useConfigForm(llmFormOptions)
  const toolPolicy = useToolPolicyForm()
  const forms: Partial<Record<SectionKey, FormState>> = {
    general: {dirty: general.dirty, saving: general.saving, invalid: general.invalid, saveError: general.saveError, save: () => general.save(), reset: () => general.reset()},
    llm: {dirty: llm.dirty, saving: llm.saving, invalid: llm.invalid, saveError: llm.saveError, save: () => llm.save(), reset: () => llm.reset()},
    'tool-policy': {dirty: toolPolicy.dirty, saving: toolPolicy.saving, invalid: false, saveError: toolPolicy.saveError, save: toolPolicy.save, reset: toolPolicy.reset},
  }
  const dirty: Partial<Record<SectionKey, boolean>> = Object.fromEntries(Object.entries(forms).map(([key, form]) => [key, form.dirty]))
  const hasUnsavedChanges = Object.values(forms).some(form => form.dirty)
  const firstDirty = SECTIONS.find(section => dirty[section.key])
  const activeForm = forms[active]
  const jumpTo = !activeForm?.dirty && firstDirty ? firstDirty : null
  const [shakeKey, setShakeKey] = useState(0)
  useUnsavedGuard(hasUnsavedChanges, onLeaveBlocked)
  useEffect(() => {onDirtyChange?.(hasUnsavedChanges)}, [hasUnsavedChanges, onDirtyChange])
  useEffect(() => {if (scroll.current) scroll.current.scrollTop = 0}, [active])
  useEffect(() => {
    if (!closeAttempt) return
    setShakeKey(key => key + 1)
    toast('请先保存或撤销设置修改')
  }, [closeAttempt])
  useEffect(() => {if (general.savedAt) toast.success('通用设置已保存')}, [general.savedAt])
  useEffect(() => {if (llm.savedAt) toast.success('模型参数已保存，新运行生效')}, [llm.savedAt])
  useEffect(() => {if (toolPolicy.savedAt) toast.success('工具策略已保存，新运行生效')}, [toolPolicy.savedAt])
  const openPage = (href: string, state?: unknown) => {
    if (hasUnsavedChanges) {
      onLeaveBlocked?.()
      return
    }
    if (onNavigate?.() !== false) router.push(href, state)
  }
  const sectionLabel = (key: SectionKey) => SECTIONS.find(section => section.key === key)?.label ?? ''

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
                    <Icon className={cn('size-4 shrink-0', current ? 'text-foreground' : 'text-faint')} aria-hidden/>
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
            <li className="mx-2 my-2.5 hidden h-px shrink-0 bg-border/70 @3xl/settings:block" aria-hidden/>
            <li className="shrink-0">
              <Button type="button" variant="ghost" className="w-full justify-start gap-2.5 rounded-[10px] px-3 text-muted-foreground"
                onClick={() => openPage(skillsHref(skillWorkspace), location.pathname === '/skills' ? location.state : {returnTo: location.pathname + location.search + location.hash})}><BookOpen/>Skill<ChevronRight className="ml-auto size-3.5" aria-hidden/></Button>
            </li>
            <li className="shrink-0">
              <Button type="button" variant="ghost" className="w-full justify-start gap-2.5 rounded-[10px] px-3 text-muted-foreground"
                onClick={() => openPage('/components')}><Package/>运行组件<ChevronRight className="ml-auto size-3.5" aria-hidden/></Button>
            </li>
          </ul>
        </nav>

        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          <div ref={scroll} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-5 pb-24 @3xl/settings:pr-[34px] @3xl/settings:pl-[30px]">
            <div className="@container/form mx-auto w-full max-w-4xl">
              {active === 'general' && <GeneralSection form={general}>
                <SettingsRow id="developer-mode" htmlFor="developer-mode-switch" title="开发者模式"
                  description={enabled && hasUnsavedChanges ? '请先保存或撤销设置修改，再关闭开发者模式。' : '在会话中显示日志、终端、上下文容量与请求原文。'}
                  control={<Switch id="developer-mode-switch" aria-labelledby="developer-mode-title" checked={enabled} disabled={enabled && hasUnsavedChanges} onCheckedChange={setEnabled}/>}/>
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
          <SettingsSaveBar
            mode={activeForm?.dirty ? 'edit' : 'jump'}
            show={Boolean(activeForm?.dirty) || Boolean(jumpTo)}
            shakeKey={shakeKey}
            saving={activeForm?.saving}
            invalid={activeForm?.invalid}
            saveError={activeForm?.saveError}
            onReset={() => activeForm?.reset()}
            onSave={() => void activeForm?.save()}
            jumpMessage={jumpTo ? `${sectionLabel(jumpTo.key)}有未保存的修改` : undefined}
            jumpLabel={jumpTo ? `查看${jumpTo.label}修改` : undefined}
            onJump={() => jumpTo && setActive(jumpTo.key)}
          />
        </div>
      </div>
    </div>
  )
}
