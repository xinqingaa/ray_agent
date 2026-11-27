import {Activity, ArrowLeft, BookOpen, ChevronRight, Folder, Globe, Inbox, Package, Settings, ShieldCheck, Sparkles, Sun, type UiIcon} from '@/components/ui/icons'
import {useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react'
import {toast} from 'sonner'
import {Button} from '@/components/ui/button'
import {useDeveloperMode} from '@/hooks/use-developer-mode'
import {TopbarActions} from '@/components/sidebar-chrome'
import {Link, useRouter} from '@/lib/navigation'
import {useLocation, useSearchParams} from 'react-router'
import {parseWorkspaceRoute} from '@/lib/workspace-route'
import {cn} from '@/lib/utils'
import {useConfigForm, useUnsavedGuard, SettingsSaveBar} from './form'
import {GeneralSection} from './general-section'
import {LlmSection, llmFormOptions} from './llm-section'
import {McpSection} from './mcp-section'
import {A2aSection} from './a2a-section'
import {ToolPolicySection, useToolPolicyForm} from './tool-policy-section'
import {skillsHref} from '@/lib/skill-route'
import {AppearanceSection} from './appearance-section'
import {DataSection} from './data-section'
import {WorkspaceSection} from './workspace-section'
import {UsageSection} from './usage-section'
import {settingsSource, type SettingsSectionKey} from '@/lib/settings-navigation'

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

export function SettingsView() {
  const router = useRouter()
  const {enabled: developerMode} = useDeveloperMode()
  const location = useLocation()
  const [params, setParams] = useSearchParams()
  const source = settingsSource(location.state)
  const skillWorkspace = source?.pathname === '/skills' ? new URL(source.href, window.location.origin).searchParams.get('workspace')
    : parseWorkspaceRoute(source?.pathname ?? '').workspaceId
  const skillState = source?.pathname === '/skills' ? source.state : {returnTo: source?.href ?? location.pathname + location.search + location.hash}
  const title = useRef<HTMLHeadingElement>(null)
  const scroll = useRef<HTMLDivElement>(null)
  const activeNav = useRef<HTMLButtonElement>(null)
  const active = SECTIONS.find(section => section.key === params.get('section'))?.key ?? 'general'
  const setActive = (key: SectionKey) => setParams(current => {
    const next = new URLSearchParams(current)
    next.set('section', key)
    return next
  }, {replace: true, state: location.state})
  const llm = useConfigForm(llmFormOptions)
  const toolPolicy = useToolPolicyForm()
  const [providerEditing, setProviderEditing] = useState(false)
  const [providerDirty, setProviderDirty] = useState(false)
  const providerScroll = useRef(0)
  const showingProvider = active === 'llm' && providerEditing
  const forms: Partial<Record<SectionKey, FormState>> = {
    llm: {dirty: llm.dirty, saving: llm.saving, invalid: llm.invalid, saveError: llm.saveError, save: () => llm.save(), reset: () => llm.reset()},
    'tool-policy': {dirty: toolPolicy.dirty, saving: toolPolicy.saving, invalid: false, saveError: toolPolicy.saveError, save: toolPolicy.save, reset: toolPolicy.reset},
  }
  const dirty: Partial<Record<SectionKey, boolean>> = Object.fromEntries(Object.entries(forms).map(([key, form]) => [key, form.dirty]))
  dirty.llm ||= providerDirty
  const hasUnsavedChanges = Object.values(dirty).some(Boolean)
  const firstDirty = SECTIONS.find(section => dirty[section.key])
  const activeForm = forms[active]
  const jumpTo = !dirty[active] && firstDirty ? firstDirty : null
  const [shakeKey, setShakeKey] = useState(0)
  const onLeaveBlocked = useCallback(() => {
    setShakeKey(key => key + 1)
    toast('请先保存或撤销设置修改')
  }, [])
  useUnsavedGuard(hasUnsavedChanges, onLeaveBlocked)
  useEffect(() => title.current?.focus({preventScroll: true}), [])
  useLayoutEffect(() => {
    if (scroll.current) scroll.current.scrollTop = 0
    activeNav.current?.scrollIntoView({block: 'nearest', inline: 'nearest'})
  }, [active])
  // 进入详情前的位置在切换前记下；返回列表后恢复，布局切换后再写回。
  const setProviderEditingFromList = (editing: boolean) => {
    if (editing && scroll.current) {
      providerScroll.current = scroll.current.scrollTop
      scroll.current.scrollTop = 0
    }
    setProviderEditing(editing)
  }
  useLayoutEffect(() => {
    if (!providerEditing && scroll.current) scroll.current.scrollTop = providerScroll.current
  }, [providerEditing])
  useEffect(() => {if (llm.savedAt) toast.success('模型参数已保存，新运行生效')}, [llm.savedAt])
  useEffect(() => {if (toolPolicy.savedAt) toast.success('工具策略已保存，新运行生效')}, [toolPolicy.savedAt])
  const canLeave = () => {
    if (hasUnsavedChanges) onLeaveBlocked()
    return !hasUnsavedChanges
  }

  return (
    <main aria-labelledby="settings-page-title" className="@container/settings relative h-full min-h-0 w-full bg-background">
      <h1 id="settings-page-title" ref={title} tabIndex={-1} className="sr-only">设置</h1>
      <TopbarActions><Button type="button" size="sm" variant="ghost" data-navigate onClick={() => {
        if (!canLeave()) return
        if (source) router.back()
        else router.replace('/')
      }}><ArrowLeft aria-hidden/>返回</Button></TopbarActions>
      <div className="flex h-full min-h-0 flex-col @3xl/settings:flex-row">
        <nav aria-label="设置分区" className="shrink-0 overflow-x-auto border-b bg-muted/55 px-3 py-2 @3xl/settings:w-[210px] @3xl/settings:overflow-y-auto @3xl/settings:border-b-0 @3xl/settings:px-2.5 @3xl/settings:py-4">
          <ul className="flex gap-1 @3xl/settings:flex-col">
            {SECTIONS.map(({key, label, icon: Icon}) => {
              const current = key === active
              return (
                <li key={key} className="shrink-0">
                  <button
                    ref={current ? activeNav : undefined}
                    type="button"
                    onClick={() => {if (params.get('section') !== key) setActive(key)}}
                    aria-current={current ? 'page' : undefined}
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
              <Button asChild variant="ghost" className="w-full justify-start gap-2.5 rounded-[10px] px-3 text-muted-foreground">
                <Link href={skillsHref(skillWorkspace)} state={skillState}><BookOpen aria-hidden/>Skill<ChevronRight className="ml-auto size-3.5" aria-hidden/></Link>
              </Button>
            </li>
            <li className="shrink-0">
              <Button asChild variant="ghost" className="w-full justify-start gap-2.5 rounded-[10px] px-3 text-muted-foreground">
                <Link href="/components"><Package aria-hidden/>运行组件<ChevronRight className="ml-auto size-3.5" aria-hidden/></Link>
              </Button>
            </li>
            {developerMode && <li className="shrink-0">
              <Button asChild variant="ghost" className="w-full justify-start gap-2.5 rounded-[10px] px-3 text-muted-foreground">
                <Link href="/evaluation"><Activity aria-hidden/>评测<ChevronRight className="ml-auto size-3.5" aria-hidden/></Link>
              </Button>
            </li>}
          </ul>
        </nav>

        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          <div ref={scroll} className={cn('min-h-0 flex-1 overscroll-contain px-5 pt-5 @3xl/settings:pr-[34px] @3xl/settings:pl-[30px]',
            showingProvider ? 'overflow-hidden' : 'overflow-y-auto [scrollbar-gutter:stable]', !showingProvider && (active === 'general' ? 'pb-8' : 'pb-24'))}>
            <div className={cn('@container/form mx-auto w-full max-w-4xl', showingProvider && 'h-full min-h-0')}>
              {active === 'general' && <GeneralSection hasUnsavedChanges={hasUnsavedChanges}/>}
              {active === 'workspace' && <WorkspaceSection/>}
              {active === 'appearance' && <AppearanceSection/>}
              {active === 'data' && <DataSection onNavigate={canLeave} disabledReason={hasUnsavedChanges ? '请先保存或撤销设置修改，再清空数据。' : undefined}/>}
              {(active === 'llm' || providerEditing) && <div hidden={active !== 'llm'} className={showingProvider ? 'h-full min-h-0' : undefined}>
                <LlmSection form={llm} editing={providerEditing} onEditingChange={setProviderEditingFromList} onEditorDirtyChange={setProviderDirty}/>
              </div>}
              {active === 'usage' && <UsageSection/>}
              {active === 'mcp' && <McpSection/>}
              {active === 'a2a' && <A2aSection/>}
              {active === 'tool-policy' && <ToolPolicySection form={toolPolicy}/>}
            </div>
          </div>
          <SettingsSaveBar
            mode={activeForm?.dirty ? 'edit' : 'jump'}
            show={active !== 'general' && !showingProvider && (Boolean(activeForm?.dirty) || Boolean(jumpTo))}
            shakeKey={shakeKey}
            saving={activeForm?.saving}
            invalid={activeForm?.invalid}
            saveError={activeForm?.saveError}
            onReset={() => activeForm?.reset()}
            onSave={() => void activeForm?.save()}
            jumpMessage={jumpTo ? `${jumpTo.label}有未保存的修改` : undefined}
            jumpLabel={jumpTo ? `查看${jumpTo.label}修改` : undefined}
            onJump={() => jumpTo && setActive(jumpTo.key)}
          />
        </div>
      </div>
    </main>
  )
}
