'use client'
import {useCallback, useEffect, useRef, useState} from 'react'
import {ArrowLeft, BookOpen, Check, ChevronRight, Compass, FileArchive, FileCode2, FileText, Files, Github, Info, Loader2, Pencil, Plus, RefreshCw, Search, Trash2, Upload} from 'lucide-react'
import type {ReactNode} from 'react'
import {Dialog, DialogContent, DialogTitle} from '@/components/ui/dialog'
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip'
import {MarkdownContent} from '@/components/markdown-content'
import {cn, formatFileSize} from '@/lib/utils'
import {Button} from '@/components/ui/button'
import {Input} from '@/components/ui/input'
import {Textarea} from '@/components/ui/textarea'
import {Switch} from '@/components/ui/switch'
import {skillsApi, skillsChanged, type Skill, type SkillDetail, type SkillImport} from '@/lib/api/skills'
import {toast} from 'sonner'

const OPERATION_KEY = 'rayagent:skill-import'
const CLI_HINT = '在你电脑上通过 npx skills add 安装的技能不会自动出现在 RayAgent 中。请粘贴技能的 GitHub 地址，或上传包含 SKILL.md 及相关资源的 ZIP 包。'
const errorText = (error: unknown) => error instanceof Error ? error.message : '操作失败，请重试'

/** 分区保持挂载，切换时保留编辑草稿和导入操作。 */
export function SkillsSection({onDirtyChange, active = true}: {onDirtyChange: (dirty: boolean) => void; active?: boolean}) {
  const [items, setItems] = useState<Skill[]>([])
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [detail, setDetail] = useState<SkillDetail | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [text, setText] = useState('')
  const [adding, setAdding] = useState(false)
  const [kind, setKind] = useState<'github' | 'zip' | 'manual'>('github')
  const [url, setUrl] = useState('')
  const [manualName, setManualName] = useState('')
  const [manualDescription, setManualDescription] = useState('')
  const [manualBody, setManualBody] = useState('')
  const manual = `---\nname: ${JSON.stringify(manualName)}\ndescription: ${JSON.stringify(manualDescription)}\n---\n${manualBody}\n`
  const [zip, setZip] = useState<File | null>(null)
  const [operation, setOperation] = useState<SkillImport | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const importRequest = useRef<{id: string; signature: string} | null>(null)
  const [updating, setUpdating] = useState<Skill | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [editing, setEditing] = useState(false)
  const [loading, setLoading] = useState(true)
  const addButton = useRef<HTMLButtonElement>(null)
  const sourceInput = useRef<HTMLInputElement>(null)
  const importTitle = useRef<HTMLHeadingElement>(null)
  const updateButton = useRef<HTMLButtonElement>(null)
  const detailTrigger = useRef<HTMLButtonElement | null>(null)
  const processing = busy || !!operation && ['fetching', 'validating', 'publishing'].includes(operation.stage)
  const dirty = detailOpen && !!detail && text !== detail.text || adding && (!!url || !!zip || !!manualName || !!manualDescription || !!manualBody)
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange])
  const reload = useCallback(async () => {setItems(await skillsApi.list())}, [])
  const applyOperation = useCallback((op: SkillImport) => {setOperation(op); setSelected(current => op.candidates.length === 1 ? op.candidates[0].path : op.candidates.some(c => c.path === current) ? current : null)}, [])
  useEffect(() => {
    reload().catch(e => setError(errorText(e))).finally(() => setLoading(false))
    const id = sessionStorage.getItem(OPERATION_KEY)
    if (id) skillsApi.operation(id).then(op => {applyOperation(op); setAdding(op.stage !== 'completed')}).catch(e => setError(errorText(e)))
  }, [reload, applyOperation])
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
  const changed = async () => {await reload(); skillsChanged()}
  async function preview() {
    if (kind === 'github' && /^\s*(npx|npm|\$)/.test(url)) {setError('这里需要 GitHub 地址；本机命令安装不会同步。请复制技能仓库地址，或改用 ZIP 导入。'); return}
    const signature = JSON.stringify([kind, url, manual, zip?.name, zip?.size, zip?.lastModified, updating?.name, updating?.version])
    const id = importRequest.current?.signature === signature ? importRequest.current.id : crypto.randomUUID().replaceAll('-', '')
    importRequest.current = {id, signature}
    sessionStorage.setItem(OPERATION_KEY, id)
    await act(async () => {
      let op: SkillImport
      const update = updating ? {update_name: updating.name, expected_version: updating.version} : {}
      try {
        if (kind === 'zip') {
          if (!zip) throw new Error('请选择 ZIP 技能包')
          const data = new FormData(); data.set('operation_id', id); data.set('file', zip)
          Object.entries(update).forEach(([key, value]) => data.set(key, value))
          op = await skillsApi.upload(data)
        } else {op = await skillsApi.import({operation_id: id, kind, ...(kind === 'github' ? {url} : {text: manual}), ...update})}
      } catch (error) {
        try {applyOperation(await skillsApi.operation(id))} catch { /* 未受理时可沿原身份重试 */ }
        throw error
      }
      applyOperation(op)
    })
  }
  async function open(skill: Skill) {
    if (dirty && !window.confirm('放弃尚未保存的技能修改？')) return
    await act(async () => {const data = await skillsApi.detail(skill.name); setDetail(data); setDetailOpen(true); setText(data.text); setDeleteConfirm(false); setEditing(false); setAdding(false)})
  }
  const candidate = operation?.candidates.find(c => c.path === selected)
  function clearImport() {
    setAdding(false); setUrl(''); setZip(null); setManualName(''); setManualDescription(''); setManualBody('')
    setOperation(null); setSelected(null); setUpdating(null); setError(''); importRequest.current = null
    sessionStorage.removeItem(OPERATION_KEY)
  }
  function closeImport() {
    if (processing || dirty && !window.confirm('放弃尚未保存的导入输入？')) return
    setAdding(false); setError(''); sessionStorage.removeItem(OPERATION_KEY)
  }
  function closeDetail() {
    if (busy || text !== detail?.text && !window.confirm('放弃尚未保存的技能修改？')) return
    setDetailOpen(false); setError('')
  }
  function startImport() {clearImport(); setKind('github'); setAdding(true)}
  async function install() {
    if (!operation || !candidate) return
    await act(async () => {
      const op = await skillsApi.publish(operation.id, candidate)
      if (op.stage !== 'completed') {applyOperation(op); return}
      await changed()
      if (updating) {const next = await skillsApi.detail(updating.name); setDetail(next); setText(next.text)}
      setAdding(false); sessionStorage.removeItem(OPERATION_KEY); toast.success(updating ? '技能已更新' : '技能已安装')
    })
  }
  const visibleItems = items.filter(s => `${s.name} ${s.description}`.toLowerCase().includes(query.toLowerCase()))
  const previewing = operation?.stage === 'ready'
  const feedback = error ? <div role="alert" className="rounded-md bg-state-failed-soft px-3 py-2.5 text-sm text-state-failed">{error}</div> : null
  return <section className="space-y-6" aria-label="技能管理">
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-lg font-semibold">技能 <span className="ml-1 text-sm font-normal tabular-nums text-faint">{items.length || ''}</span></h2>
      <div className="flex items-center gap-1"><Hint label="刷新技能"><Button variant="ghost" size="icon-sm" aria-label="刷新技能" disabled={processing} className="text-muted-foreground" onClick={() => act(reload)}><RefreshCw/></Button></Hint><CommunityLink/><Button ref={addButton} size="sm" className="ml-2" disabled={processing} onClick={startImport}><Plus/>新增技能</Button></div>
    </div>
    {!adding && !detailOpen && feedback}
    <div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" aria-hidden/>
      <Input aria-label="搜索技能" className="border-transparent bg-muted/60 pl-9 shadow-none" placeholder="搜索技能" value={query} onChange={e => setQuery(e.target.value)}/>
    </div>
    {loading ? <div role="status" className="flex justify-center py-12"><Loader2 className="size-5 animate-spin text-muted-foreground"/><span className="sr-only">正在加载技能</span></div> :
      visibleItems.length ? <ul className="space-y-1">{visibleItems.map(skill => <li key={skill.id} className="group flex items-center gap-3 rounded-lg px-3 transition-colors hover:bg-muted/50 motion-reduce:transition-none">
        <button className="flex min-w-0 flex-1 items-center gap-3 rounded-md py-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring" disabled={processing} onClick={event => {detailTrigger.current = event.currentTarget; void open(skill)}}>
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground"><BookOpen className="size-5"/></span>
          <span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2 text-sm font-medium">{skill.name}{skill.builtin && <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">内置</span>}</span><span className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{skill.description}</span></span>
          <ChevronRight className="size-4 shrink-0 text-faint transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"/>
        </button>
        <Switch aria-label={`${skill.enabled ? '停用' : '启用'} ${skill.name}`} checked={skill.enabled} disabled={processing} onCheckedChange={() => act(async () => {await skillsApi.toggle(skill); await changed()})}/>
      </li>)}</ul> : <div className="flex flex-col items-center gap-3 py-12 text-sm text-muted-foreground"><BookOpen className="size-7 text-faint"/><p>{query ? '没有匹配的技能' : '还没有技能'}</p>{!query && <Button variant="secondary" size="sm" onClick={startImport}><Plus/>新增技能</Button>}</div>}
    {busy && !adding && !detailOpen && <span role="status" className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-3 animate-spin"/>正在处理</span>}

    <Dialog open={active && detailOpen} onOpenChange={next => {if (!next) closeDetail()}}>
      <DialogContent aria-describedby={undefined} className="flex h-[min(42rem,calc(100dvh-3rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl motion-reduce:animate-none" onPointerDownOutside={event => event.preventDefault()} onCloseAutoFocus={event => {event.preventDefault(); detailTrigger.current?.focus()}}>
        {detail && <>
          <div className="shrink-0 px-6 pb-4 pt-6 pr-14"><div className="flex items-center gap-2"><DialogTitle className="min-w-0 break-all leading-snug">{detail.name}</DialogTitle>{detail.builtin && <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">内置</span>}</div><p className="mt-2 text-sm leading-relaxed text-muted-foreground">{detail.description}</p></div>
          {editing ? <div className="flex min-h-0 flex-1 flex-col gap-3 px-6 pb-4">{feedback}<label htmlFor="skill-editor" className="text-xs text-muted-foreground">SKILL.md</label><Textarea autoFocus id="skill-editor" value={text} disabled={busy} onChange={e => setText(e.target.value)} className="min-h-0 flex-1 resize-none font-mono text-xs leading-relaxed"/></div> : <SkillReader key={detail.id + detail.version} skill={detail} actions={!detail.builtin && <Hint label="编辑正文"><Button variant="ghost" size="icon-sm" aria-label="编辑正文" disabled={busy} onClick={() => setEditing(true)}><Pencil/></Button></Hint>} feedback={feedback}/>}
          <div className="flex shrink-0 items-center justify-between gap-3 bg-muted/40 px-6 py-3">
            <SourceInfo skill={detail}/>
            <div className="flex items-center gap-1">
              {editing ? <><Button variant="ghost" size="sm" disabled={busy} onClick={() => {if (text === detail.text || window.confirm('放弃尚未保存的技能修改？')) {setText(detail.text); setEditing(false)}}}>取消</Button><Button size="sm" disabled={busy || text === detail.text} onClick={() => act(async () => {await skillsApi.edit(detail, text); const next = await skillsApi.detail(detail.name); setDetail(next); setText(next.text); await changed(); setEditing(false); toast.success('技能已保存')})}>{busy ? <Loader2 className="animate-spin"/> : <Check/>}保存</Button></> : !detail.builtin && <>
                <Hint label="更新技能包"><Button variant="ghost" size="icon-sm" ref={updateButton} aria-label="更新技能包" disabled={processing} onClick={() => {clearImport(); setUpdating(detail); setAdding(true); setUrl(detail.source.url ?? ''); setKind(detail.source.kind === 'github' ? 'github' : 'zip'); setOperation(null); setSelected(null); setError('')}}><RefreshCw/></Button></Hint>
                <Hint label="删除技能"><Button variant="ghost" size="icon-sm" aria-label="删除技能" disabled={processing} className="text-muted-foreground hover:text-state-failed" onClick={() => setDeleteConfirm(true)}><Trash2/></Button></Hint>
              </>}
            </div>
          </div>
          <Dialog open={deleteConfirm} onOpenChange={setDeleteConfirm}><DialogContent className="motion-reduce:animate-none" aria-describedby="delete-skill-description"><DialogTitle>删除 {detail.name}？</DialogTitle><p id="delete-skill-description" className="text-sm text-muted-foreground">删除后无法在新任务中选择，已有运行仍保留引用。</p><div className="flex justify-end gap-2"><Button autoFocus variant="ghost" disabled={busy} onClick={() => setDeleteConfirm(false)}>取消</Button><Button variant="destructive" disabled={busy} onClick={() => act(async () => {await skillsApi.delete(detail); setDeleteConfirm(false); setDetailOpen(false); await changed(); toast.success('技能已删除')})}>删除</Button></div>{feedback}</DialogContent></Dialog>
        </>}
      </DialogContent>
    </Dialog>

    <Dialog open={active && adding} onOpenChange={next => {if (!next) closeImport()}}>
      <DialogContent aria-describedby={undefined} onOpenAutoFocus={event => {event.preventDefault(); if (previewing || kind === 'zip') importTitle.current?.focus(); else sourceInput.current?.focus()}} className="flex max-h-[calc(100dvh-3rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl motion-reduce:animate-none" onPointerDownOutside={event => event.preventDefault()} onCloseAutoFocus={event => {event.preventDefault(); if (detailOpen) updateButton.current?.focus(); else addButton.current?.focus()}}>
        <div className="flex shrink-0 items-center gap-2 px-6 pb-5 pt-6 pr-14">
          {previewing && <Hint label="返回来源"><Button variant="ghost" size="icon-sm" aria-label="返回来源" disabled={processing} onClick={() => {setOperation(null); setSelected(null); setError('')}}><ArrowLeft/></Button></Hint>}
          <DialogTitle ref={importTitle} tabIndex={-1} className="min-w-0 break-all leading-snug outline-none">{previewing ? '安装预览' : updating ? `更新 ${updating.name}` : '新增技能'}</DialogTitle>
          {!previewing && <Hint label={CLI_HINT}><Button variant="ghost" size="icon-xs" aria-label="导入帮助"><Info/></Button></Hint>}
          <span className="ml-auto"><CommunityLink/></span>
        </div>
        <div className={cn('min-h-0 overflow-y-auto overscroll-contain', previewing && 'flex flex-col')}>
          {!previewing ? <div className="space-y-5 px-6 pb-6">
            <div role="group" aria-label="技能来源" className="grid grid-cols-3 gap-1 rounded-lg bg-muted/60 p-1">{sources.map(({kind: sourceKind, label, icon: Icon}) => <button key={sourceKind} type="button" aria-pressed={kind === sourceKind} disabled={processing} className={cn('flex items-center justify-center gap-2 rounded-md px-2 py-2 text-sm outline-none transition-all focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 motion-reduce:transition-none', kind === sourceKind ? 'bg-card font-medium text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')} onClick={() => {setKind(sourceKind); setOperation(null); setSelected(null); setError('')}}><Icon className="size-4"/>{label}</button>)}</div>
            <div key={kind} className="animate-in fade-in slide-in-from-bottom-1 duration-200 motion-reduce:animate-none">
              {kind === 'github' && <label className="block space-y-2 text-sm">GitHub 地址<Input ref={sourceInput} autoFocus value={url} onChange={e => {setUrl(e.target.value); setOperation(null)}} placeholder="https://github.com/owner/repo" disabled={processing}/></label>}
              {kind === 'zip' && <label className={cn('relative flex min-h-40 cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-5 text-sm transition-colors hover:bg-muted/40 focus-within:ring-2 focus-within:ring-ring motion-reduce:transition-none', processing && 'pointer-events-none opacity-50')}><Upload className="size-7 text-faint"/><span className="max-w-full truncate font-medium">{zip?.name || '选择 ZIP 文件'}</span><span className="text-xs text-muted-foreground">{zip ? formatFileSize(zip.size) : '包含 SKILL.md 的完整技能包'}</span><input className="absolute inset-0 cursor-pointer opacity-0" aria-label="选择 ZIP 文件" type="file" accept=".zip,application/zip" disabled={processing} onChange={e => {setZip(e.target.files?.[0] ?? null); setOperation(null)}}/></label>}
              {kind === 'manual' && <div className="space-y-4"><label className="block space-y-2 text-sm">名称<Input ref={sourceInput} autoFocus value={manualName} disabled={processing} placeholder="my-skill" onChange={e => setManualName(e.target.value)}/></label><label className="block space-y-2 text-sm">描述<Input value={manualDescription} disabled={processing} placeholder="什么时候使用这个技能" onChange={e => setManualDescription(e.target.value)}/></label><label className="block space-y-2 text-sm">正文<Textarea className="min-h-48 font-mono text-xs leading-relaxed" value={manualBody} disabled={processing} placeholder="使用 Markdown 编写技能" onChange={e => setManualBody(e.target.value)}/></label></div>}
            </div>
            {operation && <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">{processing && <Loader2 className="size-4 animate-spin"/>}{stageLabel(operation.stage)}{operation.error && <span className="text-state-failed">{operation.error}</span>}</div>}
            {feedback}
          </div> : <div className="flex h-[min(30rem,55dvh)] min-h-0 flex-col animate-in fade-in slide-in-from-right-2 duration-200 motion-reduce:animate-none">
            {operation.candidates.length > 1 && <div className="px-6 pb-4"><label className="text-xs text-muted-foreground" htmlFor="skill-candidate">选择技能</label><select id="skill-candidate" className="mt-2 w-full rounded-md border bg-background px-3 py-2 text-sm" value={selected ?? '__select__'} onChange={e => setSelected(e.target.value)}><option value="__select__" disabled>选择要安装的技能</option>{operation.candidates.map(c => <option key={c.path} value={c.path}>{c.name}{c.path ? ` (${c.path})` : ''}</option>)}</select></div>}
            {candidate ? <><div className="px-6 pb-4"><h3 className="text-base font-medium">{candidate.name}</h3><p className="mt-1 text-sm text-muted-foreground">{candidate.description}</p></div><SkillReader key={candidate.version} skill={candidate} feedback={feedback}/></> : <p className="px-6 py-8 text-center text-sm text-muted-foreground">选择技能后预览内容</p>}
          </div>}
        </div>
        <div className="flex shrink-0 items-center justify-between gap-3 bg-muted/40 px-6 py-4">
          {operation ? <div className="flex min-w-0 items-center gap-1"><SourceInfo skill={{source: operation.source, version: candidate?.version ?? ''}}/><Hint label="查询操作结果"><Button variant="ghost" size="icon-sm" aria-label="查询操作结果" disabled={processing} onClick={() => act(async () => {applyOperation(await skillsApi.operation(operation.id)); await changed()})}><RefreshCw/></Button></Hint></div> : <span/>}
          <div className="flex items-center gap-2"><Button variant="ghost" size="sm" disabled={processing} onClick={closeImport}>取消</Button><Button size="sm" disabled={processing || (previewing ? !candidate : kind === 'github' ? !url.trim() : kind === 'zip' ? !zip : !manualName.trim() || !manualDescription.trim() || !manualBody.trim())} onClick={previewing ? install : preview}>{processing ? <Loader2 className="animate-spin"/> : previewing ? <Plus/> : <ChevronRight/>}{previewing ? updating ? '确认更新' : '安装技能' : '预览'}</Button></div>
        </div>
      </DialogContent>
    </Dialog>
  </section>
}

const sources = [{kind: 'github', label: 'GitHub', icon: Github}, {kind: 'zip', label: 'ZIP', icon: FileArchive}, {kind: 'manual', label: '创建', icon: Pencil}] as const
function stageLabel(stage: string) {
  return ({fetching: '正在获取来源', validating: '正在校验', publishing: '正在安装', completed: '已安装', failed: '导入失败', interrupted: '导入中断', expired: '预览已过期'} as Record<string, string>)[stage] ?? stage
}
function Hint({label, children}: {label: string; children: ReactNode}) {
  return <Tooltip><TooltipTrigger asChild>{children}</TooltipTrigger><TooltipContent sideOffset={6} className="max-w-72 leading-relaxed motion-reduce:animate-none">{label}</TooltipContent></Tooltip>
}
function CommunityLink() {
  return <Hint label="浏览社区技能 · skills.sh"><Button asChild variant="ghost" size="icon-sm" className="text-muted-foreground"><a href="https://skills.sh/" target="_blank" rel="noopener noreferrer" aria-label="浏览社区技能"><Compass/></a></Button></Hint>
}
function SourceInfo({skill}: {skill: {version: string; source: Skill['source']}}) {
  const source = skill.source
  return <Hint label={`${source.kind === 'builtin' ? '随应用更新' : source.url || (source.kind === 'manual' ? '手工创建' : 'ZIP 导入')}${source.commit ? ` · 提交 ${source.commit}` : ''}${skill.version ? ` · 版本 ${skill.version}` : ''}`}><Button variant="ghost" size="sm" className="min-w-0 gap-1.5 px-0 text-xs font-normal text-muted-foreground" aria-label="查看技能来源与版本"><Info className="size-3.5"/><span className="truncate">{source.kind === 'builtin' ? '随应用更新' : source.kind === 'github' ? 'GitHub' : source.kind === 'manual' ? '手工创建' : 'ZIP'}</span></Button></Hint>
}
/** Markdown 是默认阅读面；资源清单是独立、可随时返回的视图，不冒充文件预览。 */
function SkillReader({skill, actions, feedback}: {skill: Pick<SkillDetail, 'text' | 'files' | 'warnings'>; actions?: ReactNode; feedback?: ReactNode}) {
  const [view, setView] = useState<'read' | 'files'>('read')
  const body = skill.text.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '')
  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="flex shrink-0 items-center gap-1 px-6 pb-3"><Button size="sm" variant={view === 'read' ? 'secondary' : 'ghost'} aria-pressed={view === 'read'} onClick={() => setView('read')}><FileText/>说明</Button><Button size="sm" variant={view === 'files' ? 'secondary' : 'ghost'} aria-pressed={view === 'files'} onClick={() => setView('files')}><Files/>文件<span className="text-xs tabular-nums text-faint">{skill.files.length}</span></Button><span className="ml-auto">{actions}</span></div>
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pb-6">
      <div className="mb-3 empty:hidden">{feedback}{skill.warnings.map(w => <p key={w} className="mt-2 rounded-md bg-state-waiting-soft px-3 py-2 text-xs leading-relaxed text-state-waiting">{w}</p>)}</div>
      <div key={view} className="animate-in fade-in duration-150 motion-reduce:animate-none">{view === 'read' ? <MarkdownContent content={body} className="[&_img]:max-w-full"/> : <ul aria-label="技能文件清单" className="space-y-1">{skill.files.map(file => <li key={file.path} className="flex min-w-0 items-center gap-3 rounded-md bg-muted/35 px-3 py-2.5 text-xs"><FileCode2 className="size-4 shrink-0 text-faint"/>{file.path === 'SKILL.md' ? <button className="min-w-0 flex-1 break-all text-left font-mono text-signal underline-offset-2 hover:underline" onClick={() => setView('read')}>{file.path}</button> : <span className="min-w-0 flex-1 break-all font-mono">{file.path}</span>}<span className="shrink-0 tabular-nums text-faint">{formatFileSize(file.size)}</span></li>)}</ul>}</div>
    </div>
  </div>
}
