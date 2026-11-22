import {AlertTriangle, ArrowLeft, ArrowUpRight, Ban, Check, ChevronDown, Circle, CircleCheck, Compass, Copy, Sparkles, Folder, Info, Loader2, Pencil, RefreshCw, Search, Trash2, Upload, Files, Github} from '@/components/ui/icons'
import {useCallback, useEffect, useRef, useState} from 'react'
import type {ReactNode} from 'react'
import {Dialog, DialogContent, DialogTitle} from '@/components/ui/dialog'
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip'
import {MarkdownContent} from '@/components/markdown-content'
import {SkillReader} from '@/components/skill-reader'
import {SkillMarket} from './skill-market'
import {SkillSourceTools} from './skill-source-tools'
import {cn, formatFileSize} from '@/lib/utils'
import {Button} from '@/components/ui/button'
import {Input} from '@/components/ui/input'
import {Textarea} from '@/components/ui/textarea'
import {SegmentedControl} from '@/components/ui/segmented-control'
import {Sidebar, SidebarContent, SidebarHeader, useSidebar} from '@/components/ui/sidebar'
import {MainShell, TopbarActions} from '@/components/sidebar-chrome'
import {Link} from '@/lib/navigation'
import {skillsApi, skillsChanged, type Skill, type SkillDetail, type SkillImport, type SkillSourcesPayload} from '@/lib/api/skills'
import {classifyLocalPaths, filesFromDrop, folderSkillFiles, hasSkillFrontmatter, localImportForm, skillDocument, type LocalFile} from '@/lib/skill-local'
import {isDesktop, selectFolderGrant} from '@/lib/platform'
import {ContextMenuSurface} from '@/components/ui/context-menu'
import {menuItem, type MenuEntry} from '@/lib/context-menu-policy'
import {copyText} from '@/lib/clipboard'
import {toast} from 'sonner'

const OPERATION_KEY = 'rayagent:skill-import'
const CLI_HINT = '用户目录与额外目录中的标准 Skill 会被发现；纳入后才会进入每次运行的目录。删除外部引用不会删除用户目录。'
const errorText = (error: unknown) => error instanceof Error ? error.message : '操作失败，请重试'

/** 分区保持挂载，切换时保留编辑草稿和导入操作。 */
export function SkillsSection({onDirtyChange, active = true, workspaceId, workspaces = [], onWorkspaceChange, view, onViewChange, backHref}: {
  onDirtyChange: (dirty: boolean) => void
  active?: boolean
  workspaceId?: string
  workspaces?: {id: string; name: string}[]
  onWorkspaceChange?: (workspaceId: string) => void
  view?: 'installed' | 'market'
  onViewChange?: (view: 'installed' | 'market') => void
  backHref?: string
}) {
  const {setOpenMobile} = useSidebar()
  const [conflictsOnly, setConflictsOnly] = useState(false)
  const [items, setItems] = useState<Skill[]>([])
  const [sources, setSources] = useState<SkillSourcesPayload | null>(null)
  const [sourceTools, setSourceTools] = useState<'sources' | 'issues' | null>(null)
  const manageSourcesButton = useRef<HTMLButtonElement>(null)
  const sourceToolsTrigger = useRef<HTMLButtonElement>(null)
  const [initialView, setLocalView] = useState<'installed' | 'market'>('installed')
  const tab = view ?? initialView
  const setTab = onViewChange ?? setLocalView
  const [groupFilter, setGroupFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [query, setQuery] = useState('')
  const [installedName, setInstalledName] = useState('')
  const installedRow = useRef<HTMLLIElement>(null)
  const [error, setError] = useState('')
  const [modeError, setModeError] = useState<{id: string; message: string} | null>(null)
  const [busy, setBusy] = useState(false)
  const [detail, setDetail] = useState<SkillDetail | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [text, setText] = useState('')
  const [adding, setAdding] = useState(false)
  const [kind, setKind] = useState<'github' | 'local' | 'write'>('github')
  const writing = kind === 'write'
  const [sourceSlide, setSourceSlide] = useState<'left' | 'right'>('right')
  const [url, setUrl] = useState('')
  const [manualName, setManualName] = useState('')
  const [manualDescription, setManualDescription] = useState('')
  const [manualBody, setManualBody] = useState('')
  const [localFiles, setLocalFiles] = useState<LocalFile[] | null>(null)
  const [unpackZip, setUnpackZip] = useState(false)
  const [localName, setLocalName] = useState('')
  const [localDescription, setLocalDescription] = useState('')
  const [needsMeta, setNeedsMeta] = useState(false)
  const [draftBody, setDraftBody] = useState<string | null>(null)
  const [operation, setOperation] = useState<SkillImport | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const importRequest = useRef<{id: string; signature: string} | null>(null)
  const [updating, setUpdating] = useState<Skill | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [editing, setEditing] = useState(false)
  const [candidateText, setCandidateText] = useState<string | null>(null)
  const [renderDraft, setRenderDraft] = useState(false)
  const [loading, setLoading] = useState(true)
  const addButton = useRef<HTMLButtonElement>(null)
  const sourceInput = useRef<HTMLInputElement>(null)
  const filesButton = useRef<HTMLButtonElement>(null)
  const filesInput = useRef<HTMLInputElement>(null)
  const folderInput = useRef<HTMLInputElement>(null)
  const importTitle = useRef<HTMLHeadingElement>(null)
  const updateButton = useRef<HTMLButtonElement>(null)
  const addTrigger = useRef<HTMLButtonElement | null>(null)
  const detailTrigger = useRef<HTMLButtonElement | null>(null)
  const processing = busy || !!operation && ['fetching', 'validating', 'publishing'].includes(operation.stage)
  const dirty = detailOpen && !!detail && text !== detail.text || adding && (candidateText !== null || !!url || !!localFiles?.length || !!manualName || !!manualDescription || !!manualBody || !!localName || !!localDescription)
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange])
  const reload = useCallback(async (refresh = true) => {
    const list = await skillsApi.list(workspaceId, refresh)
    const nextSources = await skillsApi.sources(workspaceId)
    setItems(list)
    setSources(nextSources)
  }, [workspaceId])
  const applyOperation = useCallback((op: SkillImport) => {setOperation(op); setSelected(current => op.candidates.length === 1 ? op.candidates[0].path : op.candidates.some(c => c.path === current) ? current : null)}, [])
  useEffect(() => {
    if (!active) return
    reload().catch(e => setError(errorText(e))).finally(() => setLoading(false))
  }, [active, reload])
  useEffect(() => {
    const id = sessionStorage.getItem(OPERATION_KEY)
    if (id) skillsApi.operation(id).then(op => {applyOperation(op); setAdding(op.stage !== 'completed')}).catch(e => setError(errorText(e)))
  }, [applyOperation])
  useEffect(() => {
    if (!operation || !['fetching', 'validating', 'publishing'].includes(operation.stage)) return
    let disposed = false
    const timer = setInterval(() => {skillsApi.operation(operation.id).then(op => {if (!disposed) applyOperation(op)}).catch(e => {if (!disposed) setError(errorText(e))})}, 1500)
    return () => {disposed = true; clearInterval(timer)}
  }, [operation, applyOperation])
  async function act(action: () => Promise<void>) {
    setBusy(true); setError('')
    try {await action()} catch (e) {setError(errorText(e))} finally {setBusy(false)}
  }
  const changed = async (refresh = false) => {await reload(refresh); skillsChanged()}
  async function setSkillMode(skill: Skill, mode: 'off' | 'selectable' | 'included') {
    setModeError(null)
    await act(async () => {
      try {
        await skillsApi.setMode(skill, mode, workspaceId)
      } catch (reason) {
        setModeError({id: skill.id, message: errorText(reason)})
        return
      }
      await changed()
    })
  }
  // 行菜单：打开、改为其他使用方式、复制名称。只列出当前能改的项，与行内的使用方式下拉同一条件
  function skillEntries(skill: Skill, shown: Skill, target: EventTarget | null): MenuEntry[] {
    const state = skillState(shown)
    const changeable = !processing && shown.source_state !== 'disabled' && state !== 'unavailable'
    const trigger = target instanceof Element ? target.closest('.skill-row')?.querySelector<HTMLButtonElement>('.skill-open') : null
    const modes: Array<{mode: 'off' | 'selectable' | 'included'; label: string; icon: typeof Ban}> = [
      {mode: 'off', label: '停用', icon: Ban},
      {mode: 'selectable', label: '设为可选择', icon: Circle},
      {mode: 'included', label: '设为每次带上', icon: CircleCheck},
    ]
    return [
      menuItem('打开', ArrowUpRight, () => {if (trigger) detailTrigger.current = trigger; void open(skill)}),
      ...(changeable ? modes.filter(item => item.mode !== state).map(item => menuItem(item.label, item.icon, () => void setSkillMode(skill, item.mode))) : []),
      menuItem('复制名称', Copy, () => copyText(skill.name)),
    ]
  }
  async function acquire(material?: {files: LocalFile[]; zip: boolean}) {
    if (kind === 'github' && /^\s*(npx|npm|\$)/.test(url)) {setError('这里需要 GitHub 地址；本机命令安装不会同步。请复制 Skill 仓库地址，或改用文件导入。'); return}
    const sourceKind = material ? 'local' : kind
    const composing = sourceKind === 'write'
    const supplement = sourceKind === 'local' && !material && needsMeta
    const signature = JSON.stringify([sourceKind, sourceKind === 'github' ? url : null,
      composing ? [manualName, manualDescription, manualBody] : supplement ? [localName, localDescription, draftBody] : null,
      material?.zip ?? unpackZip, (material?.files ?? localFiles)?.map(item => [item.path, item.file.size, item.file.lastModified]),
      updating?.name, updating?.version])
    const id = importRequest.current?.signature === signature && !['failed', 'interrupted', 'expired'].includes(operation?.stage ?? '') ? importRequest.current.id : crypto.randomUUID().replaceAll('-', '')
    importRequest.current = {id, signature}
    sessionStorage.setItem(OPERATION_KEY, id)
    await act(async () => {
      let op: SkillImport
      const update = updating ? {update_name: updating.name, expected_version: updating.version} : {}
      try {
        if (sourceKind !== 'github') {
          const documents = material?.files ?? (writing
            ? [{path: 'SKILL.md', file: new File([skillDocument(manualName, manualDescription, manualBody)], 'SKILL.md', {type: 'text/markdown'})}]
            : (localFiles ?? []).map(item => item.path === 'SKILL.md' && draftBody !== null ? {path: 'SKILL.md', file: new File([skillDocument(localName, localDescription, draftBody)], 'SKILL.md', {type: 'text/markdown'})} : item))
          if (!documents.length) throw new Error('请选择 Skill 文件')
          op = await skillsApi.uploadLocal(localImportForm(id, documents, material ? material.zip : unpackZip && !writing, updating ? {update_name: updating.name, expected_version: updating.version} : undefined))
        } else {op = await skillsApi.import({operation_id: id, kind: 'github', url, ...update})}
      } catch (error) {
        try {applyOperation(await skillsApi.operation(id))} catch { /* 未受理时可沿原身份重试 */ }
        throw error
      }
      applyOperation(op)
    })
  }
  async function open(skill: Skill) {
    if (dirty && !window.confirm('放弃尚未保存的 Skill 修改？')) return
    await act(async () => {const data = await skillsApi.detail(skill.id, workspaceId); setDetail(data); setDetailOpen(true); setText(data.text); setDeleteConfirm(false); setEditing(false); setAdding(false)})
  }
  async function rescan() {
    await act(async () => {
      const scanned = await skillsApi.scan(workspaceId)
      const nextSources = await skillsApi.sources(workspaceId)
      setItems(scanned)
      setSources(nextSources)
      skillsChanged()
    })
  }
  function openSourceTools(tool: 'sources' | 'issues', trigger: HTMLButtonElement) {
    sourceToolsTrigger.current = trigger
    setError('')
    setSourceTools(tool)
  }
  async function addExtraDir() {
    if (!isDesktop()) {setError('请在桌面应用中选择额外 Skill 目录'); return}
    await act(async () => {
      const grant = await selectFolderGrant('skill_extra_dir')
      if (!grant) return
      await skillsApi.addExtraDir(grant.grant_id)
      await changed()
      toast.success('已添加 Skill 目录')
    })
  }
  async function toggleSource(sourceId: string, enabled: boolean) {
    if (!sources) return
    const disabled = new Set(sources.config.disabled_sources)
    if (enabled) disabled.delete(sourceId); else disabled.add(sourceId)
    await act(async () => {
      await skillsApi.updateConfig({...sources.config, disabled_sources: [...disabled]})
      await changed(enabled)
    })
  }
  async function toggleGroup(group: string, enabled: boolean) {
    if (!sources) return
    const disabled = new Set(sources.config.disabled_groups)
    if (enabled) disabled.delete(group); else disabled.add(group)
    await act(async () => {
      await skillsApi.updateConfig({...sources.config, disabled_groups: [...disabled]})
      await changed(enabled)
    })
  }
  const candidate = operation?.candidates.find(c => c.path === selected)
  function clearLocal() {
    setLocalFiles(null); setUnpackZip(false); setNeedsMeta(false); setDraftBody(null)
    setLocalName(''); setLocalDescription(''); setOperation(null); setSelected(null); setError('')
  }
  async function acceptLocal(items: LocalFile[], mode: 'loose' | 'folder') {
    const classified = classifyLocalPaths(items.map(item => item.path), mode)
    if (!classified.ok) {setError(classified.error); return}
    const byPath = new Map(items.map(item => [item.path, item.file]))
    let automatic: {files: LocalFile[]; zip: boolean} | null = null
    if (classified.zip) {
      const file = byPath.get(classified.path)
      if (!file) {setError('没有可导入的文件'); return}
      setLocalFiles([{path: file.name, file}]); setUnpackZip(true); setNeedsMeta(false); setDraftBody(null)
      automatic = {files: [{path: file.name, file}], zip: true}
    } else {
      const skill = classified.skillFrom ? byPath.get(classified.skillFrom) : undefined
      let body: string | null = null
      if (skill) {
        const text = (await skill.text()).replace(/^\uFEFF/, '')
        if (!hasSkillFrontmatter(text)) body = text
      }
      const files = classified.files.map(item => {
        const file = byPath.get(item.from)
        if (!file) throw new Error('没有可导入的文件')
        return {path: item.path, file}
      })
      setLocalFiles(files)
      setUnpackZip(false); setNeedsMeta(body !== null); setDraftBody(body)
      if (body === null) automatic = {files, zip: false}
    }
    setManualName(''); setManualDescription(''); setManualBody(''); setOperation(null); setSelected(null); setError('')
    if (automatic) await acquire(automatic)
  }
  function clearImport() {
    setAdding(false); setUrl(''); clearLocal(); setCandidateText(null); setRenderDraft(false)
    setManualName(''); setManualDescription(''); setManualBody('')
    setOperation(null); setSelected(null); setUpdating(null); setError(''); importRequest.current = null
    sessionStorage.removeItem(OPERATION_KEY)
  }
  function closeImport() {
    if (processing || dirty && !window.confirm('放弃尚未保存的导入输入？')) return
    setAdding(false); setError(''); sessionStorage.removeItem(OPERATION_KEY)
  }
  function closeDetail() {
    if (busy || text !== detail?.text && !window.confirm('放弃尚未保存的 Skill 修改？')) return
    setDetailOpen(false); setError('')
  }
  function startImport(trigger: HTMLButtonElement) {
    addTrigger.current = trigger
    setTab('installed')
    setOpenMobile(false)
    clearImport()
    setKind('github')
    setAdding(true)
  }
  async function finishInstall(op: SkillImport) {
    if (op.stage !== 'completed' || !op.result) {applyOperation(op); return}
    sessionStorage.removeItem(OPERATION_KEY); skillsChanged()
    toast.success(updating ? 'Skill 已更新' : 'Skill 已安装')
    if (op.notice) toast.warning(op.notice)
    const [reading, listing] = await Promise.allSettled([skillsApi.detail(op.result.id, workspaceId), reload(false)])
    setAdding(false); setOperation(null); setCandidateText(null)
    if (reading.status === 'fulfilled') {
      const next = reading.value
      setDetail(next); setText(next.text); setEditing(false); setDetailOpen(true)
      setQuery(''); setGroupFilter(''); setStatusFilter(''); setConflictsOnly(false)
      setInstalledName(op.result.id)
    }
    if (reading.status === 'rejected' || listing.status === 'rejected') setError('安装已成功，读取最新详情或列表失败，请刷新。')
  }
  async function install() {
    if (!operation || !candidate) return
    await act(async () => {
      try {await finishInstall(await skillsApi.publish(operation.id, candidate))} catch (error) {
        const latest = await skillsApi.operation(operation.id).catch(() => null)
        if (latest?.stage === 'completed') await finishInstall(latest)
        else throw error
      }
    })
  }
  async function deleteSkill() {
    if (!detail) return
    await act(async () => {
      try {await skillsApi.delete(detail, workspaceId)} catch (error) {
        const remaining = await skillsApi.list(workspaceId, false)
        if (remaining.some(s => s.id === detail.id)) throw error
      }
      setDeleteConfirm(false); setDetailOpen(false); skillsChanged(); toast.success(detail.external ? '已移除外部引用' : 'Skill 已删除')
      try {await reload()} catch {setError('Skill 已删除，列表刷新失败，请刷新。')}
    })
  }
  const conflictNames = new Set(items.filter(skill => skill.conflict).map(skill => skill.name))
  const conflictCandidates = items.filter(skill => conflictNames.has(skill.name) && skill.enabled)
  const sourceGroup = sources?.groups.find(group => group.id === groupFilter)
  const directoryStates = new Map(sources?.sources.map(source => [source.source_id, source.enabled]))
  const scanProblemCount = sources?.sources.reduce((count, source) => count + source.problems.length, 0) ?? 0
  const visibleItems = items.filter(skill =>
    (!conflictsOnly || conflictNames.has(skill.name)) &&
    (!groupFilter || matchesSource(skill, groupFilter)) &&
    `${skill.name} ${skill.description}`.toLowerCase().includes(query.trim().toLowerCase()))
    .map(skill => ({skill, shown: sourceGroup ? skillInSourceGroup(skill, sourceGroup, directoryStates) : skill}))
    .filter(({shown}) => !statusFilter || statusFilter === skillState(shown))

  function showInstalled(group = '', conflicts = false) {
    setGroupFilter(group)
    setConflictsOnly(conflicts)
    setTab('installed')
    setOpenMobile(false)
  }

  const previewing = operation?.stage === 'ready'
  useEffect(() => {
    if (adding && previewing) importTitle.current?.focus({preventScroll: true})
  }, [adding, previewing])
  useEffect(() => {
    if (!detailOpen && tab === 'installed' && installedName) {
      const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      installedRow.current?.scrollIntoView?.({block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth'})
    }
  }, [detailOpen, installedName, items, tab])
  const feedback = error ? <div role="alert" className="rounded-md bg-state-failed-soft px-3 py-2.5 text-sm text-state-failed">{error}</div> : null
  return <>
    <Sidebar inline className="bg-canvas">
      <SidebarHeader className="flex h-14 shrink-0 flex-row items-center justify-between px-5 pt-3 pb-0">
        <h2 className="text-base font-semibold tracking-tight">Skill</h2>
        {tab === 'installed' && <Hint label="重新扫描来源"><Button variant="ghost" size="icon-sm" aria-label="重新扫描来源" disabled={processing}
          onClick={() => void rescan()}><RefreshCw/></Button></Hint>}
      </SidebarHeader>
      <SidebarContent className="min-h-0 gap-0 overflow-y-auto px-3 pb-4">
        <nav aria-label="Skill 来源">
          <p className="px-2 pt-2 pb-1 text-xs text-faint">来源</p>
          <button type="button" className="skill-source-filter" aria-current={tab === 'installed' && !groupFilter && !conflictsOnly ? 'true' : undefined} onClick={() => showInstalled()}>
            <span>全部</span><span className="skill-source-count">{items.length}</span>
          </button>
          {(workspaceId ? [['workspace', '工作区']] : []).concat([['user', '用户目录'], ['managed', '应用安装'], ['builtin', '内置']]).map(([group, label]) =>
            <button type="button" key={group} className="skill-source-filter" aria-current={tab === 'installed' && groupFilter === group ? 'true' : undefined} onClick={() => showInstalled(group)}>
              <span>{label}</span><span className="skill-source-count">{items.filter(skill => matchesSource(skill, group)).length}</span>
            </button>)}
          <div className="flex items-center justify-between gap-2 px-2 pb-1 pt-4">
            <p className="text-xs text-faint">扫描目录</p>
            {sources && <button type="button" ref={manageSourcesButton}
              className="rounded px-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
              onClick={event => openSourceTools('sources', event.currentTarget)}>管理来源</button>}
          </div>
          {(sources?.groups ?? []).map(group => <button type="button" key={group.id} className="skill-source-filter"
            aria-current={tab === 'installed' && groupFilter === group.id ? 'true' : undefined} onClick={() => showInstalled(group.id)}>
            <span className="truncate">{group.label}</span><span className="skill-source-count">{group.count}</span>
          </button>)}
          {(conflictNames.size > 0 || scanProblemCount > 0) && <>
            <p className="px-2 pt-4 pb-1 text-xs text-faint">需要处理</p>
            {conflictNames.size > 0 && <button type="button" className="skill-source-filter" aria-current={tab === 'installed' && conflictsOnly ? 'true' : undefined}
              onClick={() => {setQuery(''); setStatusFilter(''); showInstalled('', true)}}>
              <span>同名冲突</span><span className="skill-source-count text-state-waiting">{conflictNames.size}</span>
            </button>}
            {scanProblemCount > 0 && <button type="button" className="skill-source-filter"
              onClick={event => openSourceTools('issues', event.currentTarget)}>
              <span>扫描问题</span><span className="skill-source-count">{scanProblemCount}</span>
            </button>}
          </>}
        </nav>
      </SidebarContent>
    </Sidebar>
    <MainShell listAvailable>
      <TopbarActions>
        {onWorkspaceChange && (workspaces.length > 0 || workspaceId) && <span className="skill-select-wrap skill-scope">
          <ChevronDown aria-hidden/>
          <select className="skill-select" aria-label="Skill 范围" value={workspaceId ?? ''}
            title={workspaceId ? workspaces.find(item => item.id === workspaceId)?.name : undefined}
            disabled={dirty || processing} onChange={event => onWorkspaceChange(event.target.value)}>
            <option value="">全局</option>
            {workspaceId && !workspaces.some(item => item.id === workspaceId) && <option value={workspaceId}>当前工作区</option>}
            {workspaces.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </span>}
        {backHref && <Button asChild variant="ghost" size="sm"><Link href={backHref} replace><ArrowLeft/>返回</Link></Button>}
      </TopbarActions>
      <section className="flex min-h-0 flex-1 overflow-hidden" aria-label="Skills">
        <div className="skill-page">
          <header className="skill-page-head">
            <h1>Skill</h1>
            {tab === 'installed' && <Button ref={addButton} size="sm" disabled={processing}
              onClick={event => startImport(event.currentTarget)}>添加 Skill</Button>}
          </header>
          <SegmentedControl idPrefix="skill-view" label="Skill 视图" className="mb-4 w-fit"
            value={tab} onValueChange={setTab} options={viewOptions}/>
          <SkillMarket active={active && tab === 'market'} workspaceId={workspaceId} installed={items} onInstalled={async id => {
            if (id) setInstalledName(id)
            await changed()
          }}/>
          <div id="skill-view-panel-installed" role="tabpanel" aria-labelledby="skill-view-installed" hidden={tab !== 'installed'} className="skill-view-panel space-y-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" aria-hidden/>
              <Input aria-label="搜索 Skill" placeholder="搜索名称或描述" value={query} onChange={event => setQuery(event.target.value)}
                className="border-transparent bg-muted/60 pl-9 shadow-none"/>
            </div>
            <SegmentedControl label="Skill 状态" className="skill-status-tabs w-96 max-w-full"
              options={statusOptions} value={statusFilter} onValueChange={setStatusFilter}/>
            {!sourceTools && !adding && !detailOpen && feedback}
            {items.some(skill => skill.catalog_overflow) && <p role="status" className="rounded-md bg-muted px-3 py-2.5 text-sm text-muted-foreground">已纳入的 Skill 放不进目录预算，请退出部分纳入。</p>}
            {conflictsOnly && [...conflictNames].map(name => <section key={name} className="space-y-2 rounded-xl border border-state-waiting/30 p-3">
              <h2 className="flex items-center gap-2 text-sm font-medium text-state-waiting"><AlertTriangle className="size-4 shrink-0" aria-hidden/>「{name}」有 {conflictCandidates.filter(skill => skill.name === name).length} 份，选择时用哪一份？</h2>
              <div className="grid gap-2 sm:grid-cols-2">
                {conflictCandidates.filter(skill => skill.name === name).map(skill => <button key={skill.id} type="button"
                  className="min-w-0 rounded-lg bg-muted/55 p-2.5 text-left text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                  disabled={processing} onClick={() => void act(async () => {
                    await skillsApi.prefer(skill.name, skill.id, workspaceId)
                    await changed()
                    if (conflictNames.size === 1) setConflictsOnly(false)
                    toast.success('已设为同名时优先使用')
                  })}>
                  <span className="block truncate text-xs text-muted-foreground" title={skill.source.path}>{sourceBadge(skill)}{skill.source.path ? ` · ${skill.source.path}` : ''}</span>
                  <span className="line-clamp-2">{skill.description}</span>
                  <span className="block font-mono text-xs text-faint">版本 {shortVersion(skill)}</span>
                </button>)}
              </div>
              <p className="text-xs text-muted-foreground">选择只影响同名时的默认条目，各来源的条目都会保留。</p>
            </section>)}
            {loading ? <p role="status" className="py-8 text-center text-sm text-muted-foreground">正在加载 Skill</p> :
              visibleItems.length ? <ul className="skill-list">{visibleItems.map(({skill, shown}) => <li key={skill.id}
                ref={skill.id === installedName ? installedRow : undefined} className="skill-row" data-mode={skillState(shown)}
                data-arriving={skill.id === installedName && !detailOpen && tab === 'installed' || undefined} onAnimationEnd={event => {
                  if (event.target === event.currentTarget && skill.id === installedName) setInstalledName('')
                }}>
                <ContextMenuSurface items={target => skillEntries(skill, shown, target)}><div className="skill-row-body">
                  <button type="button" className="skill-open" aria-label={`查看 ${skill.name}（${sourceBadge(shown)}）`}
                    disabled={processing} onClick={event => {detailTrigger.current = event.currentTarget; void open(skill)}}>
                    <span className="skill-row-icon"><Sparkles className="size-4" aria-hidden/></span>
                    <span className="skill-row-main">
                      <span className="skill-row-title"><span className="truncate">{skill.name}</span>
                        {skillState(shown) === 'unavailable' && <span className="skill-row-warning">{shown.status === 'invalid' ? '包校验失败' : '目录缺失'}</span>}
                        {shown.preferred && <span className="skill-row-preferred">同名时优先</span>}
                      </span>
                      <span className="skill-row-description">{skill.description}</span>
                      <span className="skill-row-narrow">{sourceBadge(shown)} · {shortVersion(skill)}</span>
                    </span>
                    <span className="skill-row-source">{sourceBadge(shown)}</span>
                    <span className="skill-row-version" title={skill.version}>{shortVersion(skill)}</span>
                  </button>
                  <span className="skill-select-wrap skill-mode-select">
                    <ChevronDown aria-hidden/>
                    <select aria-label={`${skill.name}（${sourceBadge(shown)}）的使用方式`} className="skill-select" data-mode={skillState(shown)}
                      value={skillState(shown)} disabled={processing || shown.source_state === 'disabled' || skillState(shown) === 'unavailable'}
                      onChange={event => {
                        const mode = event.target.value
                        if (mode === 'off' || mode === 'selectable' || mode === 'included') void setSkillMode(skill, mode)
                      }}>
                      <option value="off">{shown.source_state === 'disabled' ? '来源已停用' : '停用'}</option>
                      <option value="selectable">可选择</option>
                      <option value="included">每次带上</option>
                      {skillState(shown) === 'unavailable' && <option value="unavailable">不可用</option>}
                    </select>
                  </span>
                </div></ContextMenuSurface>
                {modeError?.id === skill.id && <p role="alert" className="pb-2 pl-11 text-xs text-state-failed">{modeError.message}</p>}
              </li>)}</ul> : <p className="py-9 text-center text-sm text-muted-foreground">没有符合条件的 Skill</p>}
          </div>
        </div>
      </section>
    </MainShell>
    {active && sourceTools && sources && <SkillSourceTools view={sourceTools} sources={sources} initialGroup={groupFilter}
      busy={processing} feedback={feedback} canAddDirectory={isDesktop()}
      onClose={() => {setSourceTools(null); setError('')}}
      onRestoreFocus={() => {
        const trigger = sourceToolsTrigger.current
        const target = trigger?.isConnected ? trigger : manageSourcesButton.current
        target?.focus({preventScroll: true})
      }}
      onGroupChange={(group, enabled) => void toggleGroup(group, enabled)}
      onDirectoryChange={(id, enabled) => void toggleSource(id, enabled)}
      onRescan={() => void rescan()}
      onAddDirectory={() => void addExtraDir()}
      onRemoveDirectory={path => void act(async () => {await skillsApi.removeExtraDir(path); await changed()})}/>}


    <Dialog open={active && detailOpen} onOpenChange={next => {if (!next) closeDetail()}}>
      <DialogContent aria-describedby={undefined} className="flex h-[min(48rem,calc(100dvh-3rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(80rem,calc(100vw-3rem))] motion-reduce:animate-none" onPointerDownOutside={event => event.preventDefault()} onCloseAutoFocus={event => {event.preventDefault(); (detailTrigger.current?.isConnected ? detailTrigger.current : addButton.current)?.focus({preventScroll: true})}}>
        {detail && <>
          <div className="shrink-0 px-6 pb-4 pt-6 pr-14"><div className="flex items-center gap-2"><DialogTitle className="min-w-0 break-all leading-snug">{detail.name}</DialogTitle>{detail.builtin && <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">内置</span>}{detail.external && <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{sourceBadge(detail)}</span>}</div><p className="mt-2 text-sm leading-relaxed text-muted-foreground">{detail.description}</p></div>
          {editing ? <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-6 pb-4">{feedback}<Button size="sm" variant="ghost" className="self-end" onClick={() => setRenderDraft(!renderDraft)}>{renderDraft ? '继续编辑' : '查看排版'}</Button>{renderDraft ? <MarkdownContent content={text.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '')}/> : <><label htmlFor="skill-editor" className="text-xs text-muted-foreground">SKILL.md</label><Textarea autoFocus id="skill-editor" value={text} disabled={busy} onChange={e => setText(e.target.value)} className="min-h-0 flex-1 resize-none font-mono text-xs leading-relaxed"/></>}</div> : <SkillReader key={detail.id + detail.version} skill={detail} readFile={path => skillsApi.file(detail, path, workspaceId)} actions={!detail.builtin && !detail.external && <Hint label="编辑正文"><Button variant="ghost" size="icon-sm" aria-label="编辑正文" disabled={busy} onClick={() => {setRenderDraft(false); setEditing(true)}}><Pencil/></Button></Hint>} feedback={feedback}/>}
          <div className="flex shrink-0 items-center justify-between gap-3 bg-muted/40 px-6 py-3">
            <SourceInfo skill={detail}/>
            <div className="flex items-center gap-1">
              {editing ? <><Button variant="ghost" size="sm" disabled={busy} onClick={() => {if (text === detail.text || window.confirm('放弃尚未保存的 Skill 修改？')) {setText(detail.text); setEditing(false)}}}>取消</Button><Button size="sm" disabled={busy || text === detail.text} onClick={() => act(async () => {await skillsApi.edit(detail, text); const next = await skillsApi.detail(detail.id, workspaceId); setDetail(next); setText(next.text); await changed(); setEditing(false); toast.success('Skill 已保存')})}>{busy ? <Loader2 className="animate-spin"/> : <Check/>}保存</Button></> : !detail.builtin && <>
                {!detail.external && <Hint label="更新 Skill"><Button variant="ghost" size="icon-sm" ref={updateButton} aria-label="更新 Skill" disabled={processing} onClick={() => {clearImport(); setUpdating(detail); setAdding(true); setUrl(detail.source.url ?? ''); setKind(detail.source.kind === 'github' || detail.source.url ? 'github' : 'local'); setManualName(detail.name); setManualDescription(detail.description); setOperation(null); setSelected(null); setError('')}}><RefreshCw/></Button></Hint>}
                <Hint label={detail.external ? '移除引用' : '删除 Skill'}><Button variant="ghost" size="icon-sm" aria-label={detail.external ? '移除引用' : '删除 Skill'} disabled={processing} className="text-muted-foreground hover:text-state-failed" onClick={() => setDeleteConfirm(true)}><Trash2/></Button></Hint>
              </>}
            </div>
          </div>
          <Dialog open={deleteConfirm} onOpenChange={setDeleteConfirm}><DialogContent className="motion-reduce:animate-none" aria-describedby="delete-skill-description"><DialogTitle>{detail.external ? `移除 ${detail.name} 的引用？` : `删除 ${detail.name}？`}</DialogTitle><p id="delete-skill-description" className="text-sm text-muted-foreground">{detail.external ? '只会移除 RayAgent 中的引用与快照登记，不会删除你电脑上的 Skill 目录。已有运行仍保留原快照。' : '删除后无法在新任务中选择，已有运行仍保留引用。'}</p><div className="flex justify-end gap-2"><Button autoFocus variant="ghost" disabled={busy} onClick={() => setDeleteConfirm(false)}>取消</Button><Button variant="destructive" disabled={busy} onClick={deleteSkill}>{detail.external ? '移除引用' : '删除'}</Button></div>{feedback}</DialogContent></Dialog>
        </>}
      </DialogContent>
    </Dialog>

    <Dialog open={active && adding} onOpenChange={next => {if (!next) closeImport()}}>
      <DialogContent aria-describedby={undefined} onOpenAutoFocus={event => {event.preventDefault(); if (previewing) importTitle.current?.focus(); else if (kind === 'github' || writing || kind === 'local' && needsMeta) sourceInput.current?.focus(); else filesButton.current?.focus()}} className="skill-import-dialog flex max-w-none flex-col gap-0 overflow-hidden rounded-[22px] border-0 p-0 shadow-(--float-shadow) sm:max-w-none" onPointerDownOutside={event => event.preventDefault()} onCloseAutoFocus={event => {event.preventDefault(); if (detailOpen) updateButton.current?.focus({preventScroll: true}); else (addTrigger.current?.isConnected ? addTrigger.current : addButton.current)?.focus({preventScroll: true})}}>
        <div className="skill-import-head flex shrink-0 items-center gap-2 px-6 pr-14">
          {previewing && <Hint label="更换来源或材料"><Button variant="ghost" size="icon-sm" aria-label="更换来源或材料" disabled={processing || candidateText !== null} onClick={() => {setOperation(null); setSelected(null); setCandidateText(null); setError('')}}><ArrowLeft/></Button></Hint>}
          <DialogTitle ref={importTitle} tabIndex={-1} className="min-w-0 truncate leading-snug outline-none">{previewing ? candidate?.name ?? '选择 Skill' : updating ? `更新 ${updating.name}` : '添加 Skill'}</DialogTitle>
          {!previewing && <Hint label={CLI_HINT}><Button variant="ghost" size="icon-xs" aria-label="导入帮助"><Info/></Button></Hint>}
          <span className="ml-auto"><CommunityLink/></span>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          {!previewing ? <div className="flex h-full min-h-0 flex-col px-6 pb-4">
            <div inert={processing}>
              <SegmentedControl idPrefix="skill-import-method" label="Skill 来源" options={importKinds} value={kind} onValueChange={next => {
                if (processing || next === kind) return
                setSourceSlide(importKinds.findIndex(source => source.value === next) > importKinds.findIndex(source => source.value === kind) ? 'right' : 'left')
                setKind(next); setOperation(null); setSelected(null); setError('')
              }}/>
            </div>
            <div key={kind} role="tabpanel" id={`skill-import-method-panel-${kind}`} aria-labelledby={`skill-import-method-${kind}`}
              className={cn('skill-import-content mt-5 min-h-0 flex-1 overflow-y-auto overscroll-contain', sourceSlide === 'right' ?
                'animate-in fade-in slide-in-from-right-4 duration-200 motion-reduce:animate-none' :
                'animate-in fade-in slide-in-from-left-4 duration-200 motion-reduce:animate-none')}>
              {kind === 'github' && <div className="space-y-2">
                <label className="block space-y-2 text-sm">GitHub 地址
                  <Input ref={sourceInput} value={url} onChange={event => {setUrl(event.target.value); setOperation(null)}}
                    placeholder="https://github.com/owner/repo" disabled={processing}/>
                </label>
                <p className="text-xs text-muted-foreground">获取并校验公开仓库，查看内容后确认安装。</p>
              </div>}
              {writing && <div className="space-y-3">
                <label className="block space-y-1.5 text-sm">名称<Input ref={sourceInput} value={manualName} disabled={processing}
                  placeholder="my-skill" onChange={event => {setManualName(event.target.value); setOperation(null)}}/></label>
                <label className="block space-y-1.5 text-sm">描述<Input value={manualDescription} disabled={processing}
                  placeholder="什么时候使用这个 Skill" onChange={event => {setManualDescription(event.target.value); setOperation(null)}}/></label>
                <div className="flex items-center justify-between text-sm"><span>正文</span><Button type="button" size="xs" variant="ghost"
                  onClick={() => setRenderDraft(!renderDraft)}>{renderDraft ? '继续编辑' : '查看排版'}</Button></div>
                {renderDraft ? <MarkdownContent content={manualBody}/> : <Textarea aria-label="正文" className="min-h-32 font-mono text-xs leading-relaxed"
                  value={manualBody} disabled={processing} placeholder="使用 Markdown 编写 Skill" onChange={event => {setManualBody(event.target.value); setOperation(null)}}/>}
              </div>}
              {kind === 'local' && (localFiles ? <div className="space-y-3">
                <ul aria-label="将导入的文件" className="max-h-40 divide-y overflow-auto rounded-lg border">{localFiles.map(item => <li key={item.path}
                  className="flex items-center gap-3 px-3 py-2 text-sm"><span className="min-w-0 flex-1 truncate font-mono text-xs">{item.path}</span>
                  <span className="shrink-0 tabular-nums text-xs text-muted-foreground">{formatFileSize(item.file.size)}</span></li>)}</ul>
                <Button type="button" variant="ghost" size="xs" disabled={processing} onClick={clearLocal}>清空</Button>
                {needsMeta && <>
                  <label className="block space-y-1.5 text-sm">名称<Input ref={sourceInput} value={localName} disabled={processing}
                    placeholder="my-skill" onChange={event => {setLocalName(event.target.value); setOperation(null)}}/></label>
                  <label className="block space-y-1.5 text-sm">描述<Input value={localDescription} disabled={processing}
                    placeholder="什么时候使用这个 Skill" onChange={event => {setLocalDescription(event.target.value); setOperation(null)}}/></label>
                </>}
              </div> : <div className="skill-import-drop" onDragOver={event => event.preventDefault()} onDrop={event => {
                event.preventDefault()
                if (!processing) void filesFromDrop(event.dataTransfer.items).then(result => acceptLocal(result.files, result.mode)).catch(error => setError(errorText(error)))
              }}>
                <Upload className="mb-2 size-5 text-muted-foreground" aria-hidden/>
                <p className="text-sm font-medium">拖入文件夹、ZIP 或 SKILL.md</p>
                <div className="mt-3 flex flex-wrap justify-center gap-2">
                  <Button ref={filesButton} type="button" variant="outline" size="sm" disabled={processing} onClick={() => filesInput.current?.click()}><Files/>选择文件</Button>
                  <Button type="button" variant="ghost" size="sm" disabled={processing} onClick={() => folderInput.current?.click()}><Folder/>选择文件夹</Button>
                </div>
                <input ref={filesInput} className="hidden" aria-label="选择文件" type="file" multiple accept=".zip,.md,.txt,text/markdown,text/plain,application/zip"
                  disabled={processing} onChange={event => {
                    const chosen = Array.from(event.target.files || [])
                    event.target.value = ''
                    if (chosen.length) void acceptLocal(chosen.map(file => ({path: file.name, file})), 'loose').catch(error => setError(errorText(error)))
                  }}/>
                <input ref={element => {folderInput.current = element; element?.setAttribute('webkitdirectory', '')}} className="hidden" aria-label="选择文件夹"
                  type="file" multiple disabled={processing} {...{webkitdirectory: ''}} onChange={event => {
                    const chosen = Array.from(event.target.files || [])
                    event.target.value = ''
                    if (!chosen.length) return
                    try {void acceptLocal(folderSkillFiles(chosen), 'folder').catch(error => setError(errorText(error)))}
                    catch (error) {setError(errorText(error))}
                  }}/>
              </div>)}
            </div>
            {operation && <div role="status" className="mt-4 flex shrink-0 items-center gap-2 text-sm text-muted-foreground">{processing && <Loader2 className="size-4 animate-spin"/>}{stageLabel(operation.stage)}{operation.error && <span className="text-state-failed">{operation.error}</span>}</div>}
            <div className="shrink-0 empty:hidden">{feedback}</div>
          </div> : <div className="flex h-full min-h-0 flex-col animate-in fade-in slide-in-from-right-2 duration-200 motion-reduce:animate-none">
            {operation.candidates.length > 1 && <div className="px-6 pb-4"><label className="text-xs text-muted-foreground" htmlFor="skill-candidate">选择 Skill</label><select id="skill-candidate" className="mt-2 w-full rounded-md border bg-background px-3 py-2 text-sm" value={selected ?? '__select__'} onChange={e => {setSelected(e.target.value); setCandidateText(null)}}><option value="__select__" disabled>选择要安装的 Skill</option>{operation.candidates.map(c => <option key={c.path} value={c.path}>{c.name}{c.path ? ` (${c.path})` : ''}</option>)}</select></div>}
            {candidate ? <><div className="px-6 pb-4"><p className="text-sm text-muted-foreground">{candidate.description}</p></div>{candidateText !== null ? <div className="flex min-h-0 flex-1 flex-col gap-3 px-6 pb-4">{feedback}<Textarea aria-label="编辑待安装正文" className="min-h-0 flex-1 resize-none font-mono text-xs" value={candidateText} disabled={processing} onChange={e => setCandidateText(e.target.value)}/><div className="flex justify-end gap-2"><Button variant="ghost" size="sm" disabled={processing} onClick={() => setCandidateText(null)}>取消编辑</Button><Button size="sm" disabled={processing} onClick={() => act(async () => {const op = await skillsApi.revise(operation.id, candidate, candidateText, crypto.randomUUID().replaceAll('-', '')); applyOperation(op); sessionStorage.setItem(OPERATION_KEY, op.id); setCandidateText(null)})}>保存正文</Button></div></div> : <SkillReader key={candidate.version} skill={candidate} readFile={path => skillsApi.importFile(operation.id, candidate, path)} feedback={feedback} actions={<Button variant="ghost" size="icon-sm" aria-label="编辑待安装正文" disabled={processing} onClick={() => setCandidateText(candidate.text)}><Pencil/></Button>}/>}</> : <p className="px-6 py-8 text-center text-sm text-muted-foreground">选择要打开的 Skill</p>}
          </div>}
        </div>
        <div className="skill-import-footer flex shrink-0 items-center justify-between gap-3 px-6">
          <div className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
            <span className="truncate" title="RayAgent 应用管理库">安装位置 · RayAgent 应用管理库</span>
            {operation && <Hint label="查询操作结果"><Button variant="ghost" size="icon-xs" aria-label="查询操作结果"
              disabled={processing} onClick={() => act(async () => {
                const op = await skillsApi.operation(operation.id)
                if (op.stage === 'completed') await finishInstall(op)
                else applyOperation(op)
              })}><RefreshCw/></Button></Hint>}
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <Button variant="ghost" size="sm" disabled={processing} onClick={closeImport}>取消</Button>
            {(previewing || kind !== 'local' || localFiles) && <Button size="sm"
              disabled={processing || candidateText !== null || (previewing ? !candidate : kind === 'github' ? !url.trim() :
                writing ? !manualName.trim() || !manualDescription.trim() || !manualBody.trim() :
                !localFiles?.length || needsMeta && (!localName.trim() || !localDescription.trim()))}
              onClick={() => void (previewing ? install() : acquire())}>
              {processing && <Loader2 className="animate-spin motion-reduce:animate-none"/>}
              {previewing ? updating ? '确认更新' : '安装 Skill' : kind === 'github' ? '获取' : writing ? '预览' : operation?.error ? '重试上传' : '打开内容'}
            </Button>}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  </>
}

const importKinds = [{value: 'github', label: 'GitHub', icon: Github}, {value: 'local', label: '本地文件', icon: Folder}, {value: 'write', label: '直接编写', icon: Pencil}] as const
function stageLabel(stage: string) {
  return ({fetching: '正在获取来源', validating: '正在校验', publishing: '正在安装', completed: '已安装', failed: '导入失败', interrupted: '导入中断', expired: '材料已过期'} as Record<string, string>)[stage] ?? stage
}
const viewOptions = [{value: 'installed', label: '已安装'}, {value: 'market', label: '技能市场'}] as const
const statusOptions = [
  {value: '', label: '全部'}, {value: 'selectable', label: '可选择'}, {value: 'included', label: '每次带上'},
  {value: 'off', label: '停用'}, {value: 'unavailable', label: '不可用'},
] as const

/** 来源筛选展示该组的目录状态，全部列表沿用核心选中的生效来源。 */
function skillInSourceGroup(skill: Skill, group: SkillSourcesPayload['groups'][number], states: Map<string, boolean>): Skill {
  const locations = (skill.locations?.length ? skill.locations : [{source: skill.source, status: skill.status}])
    .filter(location => location.source.group === group.id)
  if (!locations.length) return skill
  const isEnabled = (location: typeof locations[number]) => group.enabled && (
    states.get(location.source.source_id ?? '') ?? skill.source_state !== 'disabled'
  )
  const available = locations.find(location => isEnabled(location) && location.status === 'available')
  const location = available ?? locations.find(isEnabled) ?? locations[0]
  const enabled = isEnabled(location)
  return {
    ...skill, ...location, enabled: enabled && skill.enabled, preferred: enabled && skill.preferred,
    source_state: enabled ? 'enabled' : 'disabled',
  }
}

function skillState(skill: Skill) {
  if (skill.source_state === 'disabled') return 'off'
  if (skill.status === 'missing' || skill.status === 'invalid') return 'unavailable'
  if (!skill.enabled) return 'off'
  return skill.included ? 'included' : 'selectable'
}

const shortVersion = (skill: Skill) => skill.version.slice(0, 8)

function matchesSource(skill: Skill, group: string): boolean {
  return [skill.source, ...(skill.locations ?? []).map(location => location.source)]
    .some(source => source.group === group || source.kind === group ||
      group === 'managed' && !skill.builtin && !skill.external)
}

function sourceBadge(skill: Skill) {
  if (skill.builtin) return '内置'
  if (skill.source.kind === 'rayagent') return 'RayAgent 全局'
  if (skill.source.group === 'rayagent') return 'RayAgent · 工作区'
  if (skill.source.group && skill.source.group !== 'extra') return `.${skill.source.group} · ${skill.source.kind === 'workspace' ? '工作区' : '用户'}`

  const kind = skill.source?.kind
  if (kind === 'workspace') return '工作区'
  if (kind === 'user') return '用户目录'
  if (kind === 'extra') return '额外目录'
  if (kind === 'github') return 'GitHub'
  return skill.source?.label || (skill.external ? '外部' : '应用安装')
}
function Hint({label, children}: {label: string; children: ReactNode}) {
  return <Tooltip><TooltipTrigger asChild>{children}</TooltipTrigger><TooltipContent sideOffset={6} className="max-w-72 leading-relaxed motion-reduce:animate-none">{label}</TooltipContent></Tooltip>
}
function CommunityLink() {
  return <Hint label="浏览社区 Skill · skills.sh"><Button asChild variant="ghost" size="icon-sm" className="text-muted-foreground"><a href="https://skills.sh/" target="_blank" rel="noopener noreferrer" aria-label="浏览社区 Skill"><Compass/></a></Button></Hint>
}
function SourceInfo({skill}: {skill: {version: string; root_path?: string | null; source: Skill['source']}}) {
  const source = skill.source
  const label = source.kind === 'builtin' ? '随应用更新'
    : source.kind === 'github' ? 'GitHub'
    : source.kind === 'workspace' ? '工作区目录'
    : source.kind === 'user' ? '用户目录'
    : source.kind === 'extra' ? '额外目录'
    : source.label || '本地文件'
  const detailText = source.path || source.url || source.label || label
  return <Hint label={`${detailText}${source.commit ? ` · 提交 ${source.commit}` : ''}${skill.version ? ` · 快照 ${skill.version.slice(0, 12)}` : ''}${skill.root_path ? ` · ${skill.root_path}` : ''}`}><Button variant="ghost" size="sm" className="min-w-0 gap-1.5 px-0 text-xs font-normal text-muted-foreground" aria-label="查看 Skill 来源与版本"><Info className="size-3.5"/><span className="truncate">{label}</span></Button></Hint>
}
