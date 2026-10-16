'use client'
import {useCallback, useEffect, useRef, useState} from 'react'
import {ArrowLeft, BookOpen, Check, ChevronRight, Compass, Files, Folder, Github, Info, Loader2, Pencil, Plus, RefreshCw, Search, Trash2, Upload} from 'lucide-react'
import type {ReactNode} from 'react'
import {Dialog, DialogContent, DialogTitle} from '@/components/ui/dialog'
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip'
import {MarkdownContent} from '@/components/markdown-content'
import {SkillReader} from '@/components/skill-reader'
import {cn, formatFileSize} from '@/lib/utils'
import {Button} from '@/components/ui/button'
import {Input} from '@/components/ui/input'
import {Textarea} from '@/components/ui/textarea'
import {Switch} from '@/components/ui/switch'
import {skillsApi, skillsChanged, type Skill, type SkillDetail, type SkillImport} from '@/lib/api/skills'
import {classifyLocalPaths, filesFromDrop, folderSkillFiles, hasSkillFrontmatter, localImportForm, skillDocument, type LocalFile} from '@/lib/skill-local'
import {toast} from 'sonner'

const OPERATION_KEY = 'rayagent:skill-import'
const CLI_HINT = '在你电脑上通过 npx skills add 安装的 Skill 不会自动出现在 RayAgent 中。请粘贴 Skill 的 GitHub 地址，或在这里选择文件夹、ZIP 或 SKILL.md。'
const errorText = (error: unknown) => error instanceof Error ? error.message : '操作失败，请重试'

/** 分区保持挂载，切换时保留编辑草稿和导入操作。 */
export function SkillsSection({onDirtyChange, active = true}: {onDirtyChange: (dirty: boolean) => void; active?: boolean}) {
  const [items, setItems] = useState<Skill[]>([])
  const [query, setQuery] = useState('')
  const [installedName, setInstalledName] = useState('')
  const installedRow = useRef<HTMLLIElement>(null)
  useEffect(() => {installedRow.current?.scrollIntoView?.({block: 'nearest'})}, [items, installedName])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [detail, setDetail] = useState<SkillDetail | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [text, setText] = useState('')
  const [adding, setAdding] = useState(false)
  const [kind, setKind] = useState<'github' | 'local'>('github')
  const [sourceSlide, setSourceSlide] = useState<'left' | 'right'>('right')
  const [url, setUrl] = useState('')
  const [manualName, setManualName] = useState('')
  const [manualDescription, setManualDescription] = useState('')
  const [manualBody, setManualBody] = useState('')
  const [localFiles, setLocalFiles] = useState<LocalFile[] | null>(null)
  const [unpackZip, setUnpackZip] = useState(false)
  const [writing, setWriting] = useState(false)
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
  const detailTrigger = useRef<HTMLButtonElement | null>(null)
  const processing = busy || !!operation && ['fetching', 'validating', 'publishing'].includes(operation.stage)
  const dirty = detailOpen && !!detail && text !== detail.text || adding && (candidateText !== null || !!url || !!localFiles?.length || !!manualName || !!manualDescription || !!manualBody)
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
  async function acquire(material?: {files: LocalFile[]; zip: boolean}, commit = false) {
    if (kind === 'github' && /^\s*(npx|npm|\$)/.test(url)) {setError('这里需要 GitHub 地址；本机命令安装不会同步。请复制 Skill 仓库地址，或改用文件导入。'); return}
    const sourceKind = material ? 'local' : kind
    const composing = sourceKind === 'local' && !material && writing
    const supplement = !material && needsMeta
    const signature = JSON.stringify([sourceKind, sourceKind === 'github' ? url : null,
      composing || supplement ? [manualName, manualDescription, composing ? manualBody : draftBody] : null,
      material?.zip ?? unpackZip, (material?.files ?? localFiles)?.map(item => [item.path, item.file.size, item.file.lastModified]),
      updating?.name, updating?.version])
    const id = importRequest.current?.signature === signature && !['failed', 'interrupted', 'expired'].includes(operation?.stage ?? '') ? importRequest.current.id : crypto.randomUUID().replaceAll('-', '')
    importRequest.current = {id, signature}
    sessionStorage.setItem(OPERATION_KEY, id)
    await act(async () => {
      let op: SkillImport
      const update = updating ? {update_name: updating.name, expected_version: updating.version} : {}
      try {
        if (material || kind === 'local') {
          const documents = material?.files ?? (writing
            ? [{path: 'SKILL.md', file: new File([skillDocument(manualName, manualDescription, manualBody)], 'SKILL.md', {type: 'text/markdown'})}]
            : (localFiles ?? []).map(item => item.path === 'SKILL.md' && draftBody !== null ? {path: 'SKILL.md', file: new File([skillDocument(manualName, manualDescription, draftBody)], 'SKILL.md', {type: 'text/markdown'})} : item))
          if (!documents.length) throw new Error('请选择 Skill 文件')
          op = await skillsApi.uploadLocal(localImportForm(id, documents, material ? material.zip : unpackZip && !writing, updating ? {update_name: updating.name, expected_version: updating.version} : undefined))
        } else {op = await skillsApi.import({operation_id: id, kind, url, ...update})}
      } catch (error) {
        try {applyOperation(await skillsApi.operation(id))} catch { /* 未受理时可沿原身份重试 */ }
        throw error
      }
      applyOperation(op)
      if (commit && op.stage === 'ready' && op.candidates.length === 1) {
        await finishInstall(await skillsApi.publish(op.id, op.candidates[0]))
      }
    })
  }
  async function open(skill: Skill) {
    if (dirty && !window.confirm('放弃尚未保存的 Skill 修改？')) return
    await act(async () => {const data = await skillsApi.detail(skill.name); setDetail(data); setDetailOpen(true); setText(data.text); setDeleteConfirm(false); setEditing(false); setAdding(false)})
  }
  const candidate = operation?.candidates.find(c => c.path === selected)
  function clearLocal() {
    setLocalFiles(null); setUnpackZip(false); setWriting(false); setNeedsMeta(false); setDraftBody(null)
    setManualName(''); setManualDescription(''); setManualBody(''); setOperation(null); setSelected(null); setError('')
  }
  async function acceptLocal(items: LocalFile[], mode: 'loose' | 'folder') {
    const classified = classifyLocalPaths(items.map(item => item.path), mode)
    if (!classified.ok) {setError(classified.error); return}
    const byPath = new Map(items.map(item => [item.path, item.file]))
    let automatic: {files: LocalFile[]; zip: boolean} | null = null
    if (classified.zip) {
      const file = byPath.get(classified.path)
      if (!file) {setError('没有可导入的文件'); return}
      setLocalFiles([{path: file.name, file}]); setUnpackZip(true); setWriting(false); setNeedsMeta(false); setDraftBody(null)
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
      setUnpackZip(false); setWriting(false); setNeedsMeta(body !== null); setDraftBody(body)
      if (body === null) automatic = {files, zip: false}
    }
    setManualName(''); setManualDescription(''); setManualBody(''); setOperation(null); setSelected(null); setError('')
    if (automatic) await acquire(automatic)
  }
  function clearImport() {
    setAdding(false); setUrl(''); clearLocal(); setCandidateText(null); setRenderDraft(false)
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
  function startImport() {clearImport(); setKind('github'); setAdding(true)}
  async function finishInstall(op: SkillImport) {
    if (op.stage !== 'completed' || !op.result) {applyOperation(op); return}
    setAdding(false); setOperation(null); setCandidateText(null)
    sessionStorage.removeItem(OPERATION_KEY); skillsChanged()
    toast.success(updating ? 'Skill 已更新' : 'Skill 已安装')
    try {
      const next = await skillsApi.detail(op.result.name)
      setDetail(next); setText(next.text); setEditing(false); setDetailOpen(true)
      setQuery(''); setInstalledName(op.result.name)
      await reload()
    } catch {setError('安装已成功，读取最新详情或列表失败，请刷新。')}
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
      try {await skillsApi.delete(detail)} catch (error) {
        const remaining = await skillsApi.list()
        if (remaining.some(s => s.name === detail.name)) throw error
      }
      setDeleteConfirm(false); setDetailOpen(false); skillsChanged(); toast.success('Skill 已删除')
      try {await reload()} catch {setError('Skill 已删除，列表刷新失败，请刷新。')}
    })
  }
  const visibleItems = items.filter(s => `${s.name} ${s.description}`.toLowerCase().includes(query.toLowerCase()))
  const previewing = operation?.stage === 'ready'
  const feedback = error ? <div role="alert" className="rounded-md bg-state-failed-soft px-3 py-2.5 text-sm text-state-failed">{error}</div> : null
  return <section className="space-y-6" aria-label="Skills">
    <div className="flex items-start justify-between gap-3">
      <div>
        <h2 className="text-lg font-semibold">Skills <span className="ml-1 text-sm font-normal tabular-nums text-faint">{items.length || ''}</span></h2>
        <p className="mt-1 text-sm text-muted-foreground">Skills 就是技能包。</p>
      </div>
      <div className="flex items-center gap-1"><Hint label="刷新"><Button variant="ghost" size="icon-sm" aria-label="刷新" disabled={processing} className="text-muted-foreground" onClick={() => act(reload)}><RefreshCw/></Button></Hint><CommunityLink/><Button ref={addButton} size="sm" className="ml-2" disabled={processing} onClick={startImport}><Plus/>新增 Skill</Button></div>
    </div>
    {!adding && !detailOpen && feedback}
    <div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" aria-hidden/>
      <Input aria-label="搜索 Skill" className="border-transparent bg-muted/60 pl-9 shadow-none" placeholder="搜索 Skill" value={query} onChange={e => setQuery(e.target.value)}/>
    </div>
    {loading ? <div role="status" className="flex justify-center py-12"><Loader2 className="size-5 animate-spin text-muted-foreground"/><span className="sr-only">正在加载 Skill</span></div> :
      visibleItems.length ? <ul className="space-y-1">{visibleItems.map(skill => <li key={skill.id} ref={skill.name === installedName ? installedRow : undefined} className="group flex items-center gap-3 rounded-lg px-3 transition-colors hover:bg-muted/50 motion-reduce:transition-none">
        <button className="flex min-w-0 flex-1 items-center gap-3 rounded-md py-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring" disabled={processing} onClick={event => {detailTrigger.current = event.currentTarget; void open(skill)}}>
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground"><BookOpen className="size-5"/></span>
          <span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2 text-sm font-medium">{skill.name}{skill.builtin && <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">内置</span>}</span><span className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{skill.description}</span></span>
          <ChevronRight className="size-4 shrink-0 text-faint transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"/>
        </button>
        <Switch aria-label={`${skill.enabled ? '停用' : '启用'} ${skill.name}`} checked={skill.enabled} disabled={processing} onCheckedChange={() => act(async () => {await skillsApi.toggle(skill); await changed()})}/>
      </li>)}</ul> : <div className="flex flex-col items-center gap-3 py-12 text-sm text-muted-foreground"><BookOpen className="size-7 text-faint"/><p>{query ? '没有匹配的 Skill' : '还没有 Skill'}</p>{!query && <Button variant="secondary" size="sm" onClick={startImport}><Plus/>新增 Skill</Button>}</div>}
    {busy && !adding && !detailOpen && <span role="status" className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-3 animate-spin"/>正在处理</span>}

    <Dialog open={active && detailOpen} onOpenChange={next => {if (!next) closeDetail()}}>
      <DialogContent aria-describedby={undefined} className="flex h-[min(48rem,calc(100dvh-3rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(80rem,calc(100vw-3rem))] motion-reduce:animate-none" onPointerDownOutside={event => event.preventDefault()} onCloseAutoFocus={event => {event.preventDefault(); detailTrigger.current?.focus()}}>
        {detail && <>
          <div className="shrink-0 px-6 pb-4 pt-6 pr-14"><div className="flex items-center gap-2"><DialogTitle className="min-w-0 break-all leading-snug">{detail.name}</DialogTitle>{detail.builtin && <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">内置</span>}</div><p className="mt-2 text-sm leading-relaxed text-muted-foreground">{detail.description}</p></div>
          {editing ? <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-6 pb-4">{feedback}<Button size="sm" variant="ghost" className="self-end" onClick={() => setRenderDraft(!renderDraft)}>{renderDraft ? '继续编辑' : '查看排版'}</Button>{renderDraft ? <MarkdownContent content={text.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '')}/> : <><label htmlFor="skill-editor" className="text-xs text-muted-foreground">SKILL.md</label><Textarea autoFocus id="skill-editor" value={text} disabled={busy} onChange={e => setText(e.target.value)} className="min-h-0 flex-1 resize-none font-mono text-xs leading-relaxed"/></>}</div> : <SkillReader key={detail.id + detail.version} skill={detail} actions={!detail.builtin && <Hint label="编辑正文"><Button variant="ghost" size="icon-sm" aria-label="编辑正文" disabled={busy} onClick={() => {setRenderDraft(false); setEditing(true)}}><Pencil/></Button></Hint>} feedback={feedback}/>}
          <div className="flex shrink-0 items-center justify-between gap-3 bg-muted/40 px-6 py-3">
            <SourceInfo skill={detail}/>
            <div className="flex items-center gap-1">
              {editing ? <><Button variant="ghost" size="sm" disabled={busy} onClick={() => {if (text === detail.text || window.confirm('放弃尚未保存的 Skill 修改？')) {setText(detail.text); setEditing(false)}}}>取消</Button><Button size="sm" disabled={busy || text === detail.text} onClick={() => act(async () => {await skillsApi.edit(detail, text); const next = await skillsApi.detail(detail.name); setDetail(next); setText(next.text); await changed(); setEditing(false); toast.success('Skill 已保存')})}>{busy ? <Loader2 className="animate-spin"/> : <Check/>}保存</Button></> : !detail.builtin && <>
                <Hint label="更新 Skill"><Button variant="ghost" size="icon-sm" ref={updateButton} aria-label="更新 Skill" disabled={processing} onClick={() => {clearImport(); setUpdating(detail); setAdding(true); setUrl(detail.source.url ?? ''); setKind(detail.source.kind === 'github' ? 'github' : 'local'); setOperation(null); setSelected(null); setError('')}}><RefreshCw/></Button></Hint>
                <Hint label="删除 Skill"><Button variant="ghost" size="icon-sm" aria-label="删除 Skill" disabled={processing} className="text-muted-foreground hover:text-state-failed" onClick={() => setDeleteConfirm(true)}><Trash2/></Button></Hint>
              </>}
            </div>
          </div>
          <Dialog open={deleteConfirm} onOpenChange={setDeleteConfirm}><DialogContent className="motion-reduce:animate-none" aria-describedby="delete-skill-description"><DialogTitle>删除 {detail.name}？</DialogTitle><p id="delete-skill-description" className="text-sm text-muted-foreground">删除后无法在新任务中选择，已有运行仍保留引用。</p><div className="flex justify-end gap-2"><Button autoFocus variant="ghost" disabled={busy} onClick={() => setDeleteConfirm(false)}>取消</Button><Button variant="destructive" disabled={busy} onClick={deleteSkill}>删除</Button></div>{feedback}</DialogContent></Dialog>
        </>}
      </DialogContent>
    </Dialog>

    <Dialog open={active && adding} onOpenChange={next => {if (!next) closeImport()}}>
      <DialogContent aria-describedby={undefined} onOpenAutoFocus={event => {event.preventDefault(); if (previewing) importTitle.current?.focus(); else if (kind === 'github' || writing || needsMeta) sourceInput.current?.focus(); else filesButton.current?.focus()}} className="flex h-[min(40rem,calc(100dvh-3rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(64rem,calc(100vw-3rem))] motion-reduce:animate-none [&_input:focus-visible]:border-foreground/30 [&_input:focus-visible]:ring-0 [&_textarea:focus-visible]:border-foreground/30 [&_textarea:focus-visible]:ring-0" onPointerDownOutside={event => event.preventDefault()} onCloseAutoFocus={event => {event.preventDefault(); if (detailOpen) updateButton.current?.focus(); else addButton.current?.focus()}}>
        <div className="flex shrink-0 items-center gap-2 px-6 pb-5 pt-6 pr-14">
          {previewing && <Hint label="更换来源或材料"><Button variant="ghost" size="icon-sm" aria-label="更换来源或材料" disabled={processing || candidateText !== null} onClick={() => {setOperation(null); setSelected(null); setCandidateText(null); setError('')}}><ArrowLeft/></Button></Hint>}
          <DialogTitle ref={importTitle} tabIndex={-1} className="min-w-0 break-all leading-snug outline-none">{previewing ? candidate?.name ?? '选择 Skill' : updating ? `更新 ${updating.name}` : '新增 Skill'}</DialogTitle>
          {!previewing && <Hint label={CLI_HINT}><Button variant="ghost" size="icon-xs" aria-label="导入帮助"><Info/></Button></Hint>}
          <span className="ml-auto"><CommunityLink/></span>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          {!previewing ? <div className="flex h-full flex-col px-6 pb-6">
            <div role="group" aria-label="Skill 来源" className="relative isolate grid shrink-0 grid-cols-2 rounded-lg bg-muted/60 p-1">
              <span aria-hidden="true" className="pointer-events-none absolute inset-y-1 left-1 -z-10 rounded-md bg-card shadow-sm transition-transform duration-200 ease-out motion-reduce:transition-none" style={{width: 'calc((100% - 8px) / 2)', transform: `translateX(${Math.max(0, sources.findIndex(source => source.kind === kind)) * 100}%)`}}/>
              {sources.map(({kind: sourceKind, label, icon: Icon}, index) => <button key={sourceKind} type="button" aria-pressed={kind === sourceKind} disabled={processing} className={cn('relative flex items-center justify-center gap-2 rounded-md px-2 py-2 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 motion-reduce:transition-none', kind === sourceKind ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground')} onClick={() => {if (sourceKind === kind) return; setSourceSlide(index > sources.findIndex(source => source.kind === kind) ? 'right' : 'left'); setKind(sourceKind); setOperation(null); setSelected(null); setError('')}}><Icon className="size-4"/>{label}</button>)}
            </div>
            <div key={kind} className={cn('mt-5 min-h-0 flex-1 overflow-y-auto overscroll-contain', sourceSlide === 'right' ? 'animate-in fade-in slide-in-from-right-4 duration-200 motion-reduce:animate-none' : 'animate-in fade-in slide-in-from-left-4 duration-200 motion-reduce:animate-none')}>
              {kind === 'github' && <label className="block space-y-2 text-sm">GitHub 地址<Input ref={sourceInput} autoFocus value={url} onChange={e => {setUrl(e.target.value); setOperation(null)}} placeholder="https://github.com/owner/repo" disabled={processing}/></label>}
              {kind === 'local' && (writing ? <div className="space-y-4"><label className="block space-y-2 text-sm">名称<Input ref={sourceInput} autoFocus value={manualName} disabled={processing} placeholder="my-skill" onChange={e => {setManualName(e.target.value); setOperation(null)}}/></label><label className="block space-y-2 text-sm">描述<Input value={manualDescription} disabled={processing} placeholder="什么时候使用这个 Skill" onChange={e => {setManualDescription(e.target.value); setOperation(null)}}/></label><div className="flex items-center justify-between text-sm"><span>正文</span><Button type="button" size="sm" variant="ghost" onClick={() => setRenderDraft(!renderDraft)}>{renderDraft ? '继续编辑' : '查看排版'}</Button></div>{renderDraft ? <MarkdownContent content={manualBody}/> : <label className="block space-y-2 text-sm"><Textarea className="min-h-48 font-mono text-xs leading-relaxed" value={manualBody} disabled={processing} placeholder="使用 Markdown 编写 Skill" onChange={e => {setManualBody(e.target.value); setOperation(null)}}/></label>}</div> : localFiles ? <div className="space-y-4"><ul aria-label="将导入的文件" className="divide-y rounded-lg border">{localFiles.map(item => <li key={item.path} className="flex items-center gap-3 px-3 py-2 text-sm"><span className="min-w-0 flex-1 truncate font-mono text-xs">{item.path}</span><span className="shrink-0 tabular-nums text-xs text-muted-foreground">{formatFileSize(item.file.size)}</span></li>)}</ul><Button type="button" variant="ghost" size="sm" disabled={processing} onClick={clearLocal}>清空</Button>{needsMeta && <><label className="block space-y-2 text-sm">名称<Input ref={sourceInput} autoFocus value={manualName} disabled={processing} placeholder="my-skill" onChange={e => {setManualName(e.target.value); setOperation(null)}}/></label><label className="block space-y-2 text-sm">描述<Input value={manualDescription} disabled={processing} placeholder="什么时候使用这个 Skill" onChange={e => {setManualDescription(e.target.value); setOperation(null)}}/></label></>}</div> : <div className={cn('overflow-hidden rounded-xl border bg-muted/15 text-sm', processing && 'pointer-events-none opacity-50')} onDragOver={event => event.preventDefault()} onDrop={event => {event.preventDefault(); if (!processing) void filesFromDrop(event.dataTransfer.items).then(result => acceptLocal(result.files, result.mode)).catch(e => setError(errorText(e)))}}><div className="flex flex-col items-center px-5 py-8 text-center sm:py-10"><span className="mb-4 flex size-11 items-center justify-center rounded-xl border bg-background text-muted-foreground"><Upload className="size-5"/></span><p className="font-medium text-foreground">添加 Skill 文件</p><p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">拖入文件夹、ZIP 或 SKILL.md</p><div className="mt-5 flex flex-wrap justify-center gap-2"><Button ref={filesButton} type="button" variant="default" size="sm" disabled={processing} onClick={() => filesInput.current?.click()}><Files/>选择文件</Button><Button type="button" variant="outline" size="sm" disabled={processing} onClick={() => folderInput.current?.click()}><Folder/>选择文件夹</Button></div><p className="mt-4 text-xs text-faint">Markdown 可与文本文件一起添加</p></div><input ref={filesInput} className="hidden" aria-label="选择文件" type="file" multiple accept=".zip,.md,.txt,text/markdown,text/plain,application/zip" disabled={processing} onChange={event => {const chosen = Array.from(event.target.files || []); event.target.value = ''; if (chosen.length) void acceptLocal(chosen.map(file => ({path: file.name, file})), 'loose').catch(e => setError(errorText(e)))}}/><input ref={element => {folderInput.current = element; element?.setAttribute('webkitdirectory', '')}} className="hidden" aria-label="选择文件夹" type="file" multiple disabled={processing} {...{webkitdirectory: ''}} onChange={event => {const chosen = Array.from(event.target.files || []); event.target.value = ''; if (!chosen.length) return; try {void acceptLocal(folderSkillFiles(chosen), 'folder').catch(e => setError(errorText(e)))} catch (e) {setError(errorText(e))}}}/><button type="button" className="flex w-full items-center gap-3 border-t bg-background px-5 py-4 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-50 motion-reduce:transition-none" disabled={processing} onClick={() => {setWriting(true); setLocalFiles(null); setUnpackZip(false); setNeedsMeta(false); setDraftBody(null); setOperation(null); setManualName(updating?.name ?? ''); setManualDescription(updating?.description ?? '')}}><Pencil className="size-4 shrink-0 text-muted-foreground"/><span className="min-w-0 flex-1"><span className="block text-sm font-medium">直接编写</span><span className="mt-0.5 block text-xs text-muted-foreground">从空白正文开始</span></span><ChevronRight className="size-4 shrink-0 text-faint"/></button></div>)}
            </div>
            {operation && <div role="status" className="mt-4 flex shrink-0 items-center gap-2 text-sm text-muted-foreground">{processing && <Loader2 className="size-4 animate-spin"/>}{stageLabel(operation.stage)}{operation.error && <span className="text-state-failed">{operation.error}</span>}</div>}
            <div className="shrink-0 empty:hidden">{feedback}</div>
          </div> : <div className="flex h-full min-h-0 flex-col animate-in fade-in slide-in-from-right-2 duration-200 motion-reduce:animate-none">
            {operation.candidates.length > 1 && <div className="px-6 pb-4"><label className="text-xs text-muted-foreground" htmlFor="skill-candidate">选择 Skill</label><select id="skill-candidate" className="mt-2 w-full rounded-md border bg-background px-3 py-2 text-sm" value={selected ?? '__select__'} onChange={e => {setSelected(e.target.value); setCandidateText(null)}}><option value="__select__" disabled>选择要安装的 Skill</option>{operation.candidates.map(c => <option key={c.path} value={c.path}>{c.name}{c.path ? ` (${c.path})` : ''}</option>)}</select></div>}
            {candidate ? <><div className="px-6 pb-4"><p className="text-sm text-muted-foreground">{candidate.description}</p></div>{candidateText !== null ? <div className="flex min-h-0 flex-1 flex-col gap-3 px-6 pb-4">{feedback}<Textarea aria-label="编辑待安装正文" className="min-h-0 flex-1 resize-none font-mono text-xs" value={candidateText} disabled={processing} onChange={e => setCandidateText(e.target.value)}/><div className="flex justify-end gap-2"><Button variant="ghost" size="sm" disabled={processing} onClick={() => setCandidateText(null)}>取消编辑</Button><Button size="sm" disabled={processing} onClick={() => act(async () => {const op = await skillsApi.revise(operation.id, candidate, candidateText, crypto.randomUUID().replaceAll('-', '')); applyOperation(op); sessionStorage.setItem(OPERATION_KEY, op.id); setCandidateText(null)})}>保存正文</Button></div></div> : <SkillReader key={candidate.version} skill={candidate} readFile={path => skillsApi.importFile(operation.id, candidate, path)} feedback={feedback} actions={<Button variant="ghost" size="icon-sm" aria-label="编辑待安装正文" disabled={processing} onClick={() => setCandidateText(candidate.text)}><Pencil/></Button>}/>}</> : <p className="px-6 py-8 text-center text-sm text-muted-foreground">选择要打开的 Skill</p>}
          </div>}
        </div>
        <div className="flex shrink-0 items-center justify-between gap-3 bg-muted/40 px-6 py-4">
          {operation ? <div className="flex min-w-0 items-center gap-1"><SourceInfo skill={{source: operation.source, version: candidate?.version ?? ''}}/><Hint label="查询操作结果"><Button variant="ghost" size="icon-sm" aria-label="查询操作结果" disabled={processing} onClick={() => act(async () => {const op = await skillsApi.operation(operation.id); if (op.stage === 'completed') await finishInstall(op); else applyOperation(op)})}><RefreshCw/></Button></Hint></div> : kind === 'local' && writing && !previewing ? <Button type="button" variant="ghost" size="sm" disabled={processing} onClick={() => {setWriting(false); setManualName(''); setManualDescription(''); setManualBody(''); setOperation(null); setError('')}}>改用文件</Button> : <span/>}
          <div className="flex items-center gap-2"><Button variant="ghost" size="sm" disabled={processing} onClick={closeImport}>取消</Button>{(previewing || kind === 'github' || writing || localFiles) && <Button size="sm" disabled={processing || candidateText !== null || (previewing ? !candidate : kind === 'github' ? !url.trim() : writing ? !manualName.trim() || !manualDescription.trim() || !manualBody.trim() : !localFiles?.length || needsMeta && (!manualName.trim() || !manualDescription.trim()))} onClick={() => previewing ? install() : acquire(undefined, kind === 'local' && writing)}>{processing ? <Loader2 className="animate-spin"/> : previewing || kind === 'local' && writing ? <Plus/> : <ChevronRight/>}{previewing || kind === 'local' && writing ? updating ? '确认更新' : '安装 Skill' : kind === 'github' ? '获取' : operation?.error ? '重试上传' : '打开内容'}</Button>}</div>
        </div>
      </DialogContent>
    </Dialog>
  </section>
}

const sources = [{kind: 'github', label: 'GitHub', icon: Github}, {kind: 'local', label: '本地内容', icon: Folder}] as const
function stageLabel(stage: string) {
  return ({fetching: '正在获取来源', validating: '正在校验', publishing: '正在安装', completed: '已安装', failed: '导入失败', interrupted: '导入中断', expired: '材料已过期'} as Record<string, string>)[stage] ?? stage
}
function Hint({label, children}: {label: string; children: ReactNode}) {
  return <Tooltip><TooltipTrigger asChild>{children}</TooltipTrigger><TooltipContent sideOffset={6} className="max-w-72 leading-relaxed motion-reduce:animate-none">{label}</TooltipContent></Tooltip>
}
function CommunityLink() {
  return <Hint label="浏览社区 Skill · skills.sh"><Button asChild variant="ghost" size="icon-sm" className="text-muted-foreground"><a href="https://skills.sh/" target="_blank" rel="noopener noreferrer" aria-label="浏览社区 Skill"><Compass/></a></Button></Hint>
}
function SourceInfo({skill}: {skill: {version: string; source: Skill['source']}}) {
  const source = skill.source
  const label = source.kind === 'builtin' ? '随应用更新' : source.kind === 'github' ? 'GitHub' : '本地文件'
  const detailText = source.kind === 'github' ? source.url || 'GitHub' : label
  return <Hint label={`${detailText}${source.commit ? ` · 提交 ${source.commit}` : ''}${skill.version ? ` · 版本 ${skill.version}` : ''}`}><Button variant="ghost" size="sm" className="min-w-0 gap-1.5 px-0 text-xs font-normal text-muted-foreground" aria-label="查看 Skill 来源与版本"><Info className="size-3.5"/><span className="truncate">{label}</span></Button></Hint>
}
