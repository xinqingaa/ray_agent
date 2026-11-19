import {useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react'
import {Check, History, Loader2, MoreHorizontal, Pencil, Wand, X} from '@/components/ui/icons'
import {toast} from 'sonner'
import {Button} from '@/components/ui/button'
import {Input} from '@/components/ui/input'
import {Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle} from '@/components/ui/dialog'
import {MarkdownContent} from '@/components/markdown-content'
import {useUnsavedNavigation} from '@/hooks/use-unsaved-navigation'
import {IconAction} from '@/components/ui/icon-action'
import {useSessionTitleLookup} from '@/hooks/use-session-title'
import {parseEventTime} from '@/lib/utils'
import {Textarea} from '@/components/ui/textarea'
import {instructionApi} from '@/lib/api/instruction'
import {ApiError} from '@/lib/api/fetch'
import type {InstructionProposalView, InstructionVersionView, InstructionView, TemplateView, WorkspaceItem} from '@/lib/api/types'
import {reportWorkspaceError} from '@/lib/workspace-mutation'
import {describeWorkspace} from '@/lib/workspace-state'
import {useWorkspaces} from '@/providers/workspaces-provider'

const CHANGE_SOURCE = {user_edit: '你编辑', confirmed_proposal: '采纳建议', template: '应用模板'} as const

function DocumentChange({before, after}: {before: string; after: string}) {
  const original = Array.from(before)
  const updated = Array.from(after)
  let start = 0
  let end = 0
  while (start < original.length && start < updated.length && original[start] === updated[start]) start += 1
  while (end < original.length - start && end < updated.length - start && original.at(-1 - end) === updated.at(-1 - end)) end += 1
  const removed = original.slice(start, original.length - end).join('')
  const added = updated.slice(start, updated.length - end).join('')
  const leading = original.slice(Math.max(0, start - 85), start).join('')
  const trailing = end ? original.slice(original.length - end, original.length - end + 85).join('') : ''
  return <div className="background-diff">
    {start > 85 && '…'}{leading}{removed && <del>{removed}</del>}{added && <ins>{added}</ins>}{trailing}{end > 85 && '…'}
  </div>
}

export type WorkingStyleSummary = {version: number | null; pending: number}

export function WorkingStyleSettings({workspace, onSummary}: {
  workspace: WorkspaceItem
  onSummary: (summary: WorkingStyleSummary) => void
}) {
  const {refresh} = useWorkspaces()
  const titleOf = useSessionTitleLookup()
  const condition = describeWorkspace(workspace)
  const readonly = condition.archived || condition.deleting
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [editedProposal, setEditedProposal] = useState<{id: string; body: string} | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [versions, setVersions] = useState<InstructionVersionView[]>([])
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null)
  const [nextBefore, setNextBefore] = useState<number | null>(null)
  const requestVersion = useRef(0)
  const [instruction, setInstruction] = useState<InstructionView | null>(null)
  const [body, setBody] = useState('')
  const [proposals, setProposals] = useState<InstructionProposalView[]>([])
  const [templates, setTemplates] = useState<TemplateView[]>([])
  const [templateName, setTemplateName] = useState('')
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const [proposalBusy, setProposalBusy] = useState<string | null>(null)
  const editor = useRef<HTMLTextAreaElement>(null)
  const editAction = useRef<HTMLButtonElement>(null)

  // 允许在同一工作方式版本上保存其他工作区设置更新后的草稿。
  // 若工作方式本身已变化，保留草稿原先读到的并发核对版本。
  const reviewedWorkspaceVersion = instruction && instruction.instruction_version === workspace.instruction_version
    ? Math.max(instruction.workspace_version, workspace.version)
    : instruction?.workspace_version
  const pendingCount = proposals.length

  useEffect(() => {
    if (instruction) onSummary({version: instruction.instruction_version, pending: pendingCount})
  }, [instruction, onSummary, pendingCount])

  const load = useCallback(async () => {
    const sequence = ++requestVersion.current
    setLoading(true)
    setLoadError(null)
    try {
      const [current, pending, list] = await Promise.all([
        instructionApi.get(workspace.id),
        instructionApi.proposals(workspace.id, 'pending'),
        instructionApi.listTemplates(),
      ])
      if (requestVersion.current !== sequence) return
      setInstruction(current)
      setBody(current.body)
      setProposals(pending)
      setTemplates(list)
    } catch (error) {
      if (requestVersion.current === sequence) setLoadError(error instanceof Error ? error.message : '读取工作方式失败')
    } finally {if (requestVersion.current === sequence) setLoading(false)}
  }, [workspace.id])

  useEffect(() => {
    void load()
    return () => {requestVersion.current += 1}
  }, [load])
  const dirty = (editing && body !== instruction?.body) || editedProposal !== null
  useUnsavedNavigation(() => dirty)

  useLayoutEffect(() => {
    const field = editor.current
    if (!editing || !field) return
    const calculate = () => {
      field.style.height = 'auto'
      field.style.height = `${field.scrollHeight}px`
    }
    calculate()
    window.addEventListener('resize', calculate)
    return () => window.removeEventListener('resize', calculate)
  }, [body, editing])

  const saveInstruction = async (text: string, restore = false) => {
    if (saving || readonly || reviewedWorkspaceVersion == null) return
    setSaving(true)
    try {
      const next = await instructionApi.put(workspace.id, {body: text, version: reviewedWorkspaceVersion})
      setInstruction(next)
      setBody(next.body)
      setEditing(false)
      if (restore) setHistoryOpen(false)
      else requestAnimationFrame(() => editAction.current?.focus({preventScroll: true}))
      void refresh()
      toast.success(restore ? '已恢复为新版本' : '已保存工作方式')
    } catch (error) {
      if (error instanceof ApiError && error.code === 'conflict') {
        reportWorkspaceError(error, '保存失败', () => void refresh())
        // Keep the draft until the user elects to reload the current version.
        setLoadError('工作方式或工作区状态已变化。请先保留你的修改，再重新读取。')
      } else toast.error(error instanceof Error ? error.message : '保存失败')
    } finally {setSaving(false)}
  }

  const loadHistory = async (before?: number) => {
    setHistoryLoading(true)
    setHistoryError(null)
    try {
      const result = await instructionApi.history(workspace.id, before)
      setVersions(current => before == null ? result.versions : [...current, ...result.versions])
      if (before == null) setSelectedVersion(result.versions[0]?.version ?? null)
      setNextBefore(result.next_before)
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : '读取版本失败')
    } finally {setHistoryLoading(false)}
  }

  const acceptProposal = async (id: string, edited?: string) => {
    setProposalBusy(id)
    try {
      const next = await instructionApi.acceptProposal(workspace.id, id, {body: edited, version: reviewedWorkspaceVersion})
      setInstruction(next)
      setBody(next.body)
      setEditedProposal(null)
      void refresh()
      setProposals(current => current.filter(item => item.id !== id))
      toast.success('已采纳提议')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '采纳失败')
      if (error instanceof ApiError && error.code === 'conflict') {
        setLoadError('当前版本已变化。请保留编辑内容，重新读取后审阅。')
      }
    } finally {setProposalBusy(null)}
  }

  const rejectProposal = async (id: string) => {
    setProposalBusy(id)
    try {
      await instructionApi.rejectProposal(workspace.id, id)
      setProposals(current => current.filter(item => item.id !== id))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '拒绝失败')
    } finally {setProposalBusy(null)}
  }

  const saveTemplate = async () => {
    const name = templateName.trim()
    if (!name) return
    try {
      await instructionApi.saveTemplate(workspace.id, name)
      setTemplateName('')
      setTemplates(await instructionApi.listTemplates())
      toast.success('已另存为模板')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '另存失败')
    }
  }

  const applyTemplate = async (templateId: string) => {
    if (readonly) return
    try {
      const result = await instructionApi.applyTemplate(workspace.id, templateId, workspace)
      setInstruction(result.instruction)
      setBody(result.instruction.body)
      void refresh()
      toast.success('已应用模板')
    } catch (error) {
      reportWorkspaceError(error, '应用模板失败', () => void refresh())
    }
  }

  const deleteTemplate = async (templateId: string) => {
    try {
      await instructionApi.deleteTemplate(templateId)
      setTemplates(current => current.filter(item => item.id !== templateId))
      toast.success('已删除模板')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除失败')
    }
  }

  const maxChars = instruction?.max_chars ?? 4000

  const selected = versions.find(version => version.version === selectedVersion)
  const cancelEdit = () => {
    setBody(instruction?.body ?? '')
    setEditing(false)
    requestAnimationFrame(() => editAction.current?.focus({preventScroll: true}))
  }
  return <section aria-label="工作方式" className="background-block">
    <header className="background-block-header">
      <h2 className="text-[15px] font-semibold">工作方式</h2>
      {instruction?.instruction_version != null && <span className="text-xs text-faint tabular-nums">v{instruction.instruction_version}</span>}
      <div className="background-block-actions">
        <IconAction label="工作方式模板" className="text-faint" disabled={editing || loading}
          onClick={() => setTemplatesOpen(true)}><MoreHorizontal/></IconAction>
        {editing ? <IconAction label="取消编辑" disabled={saving} onClick={cancelEdit}><X/></IconAction>
          : <IconAction label="版本历史" disabled={loading || historyLoading}
            onClick={() => {setHistoryOpen(true); void loadHistory()}}><History/></IconAction>}
        {!readonly && <IconAction ref={editAction} label={editing ? '保存工作方式' : '编辑工作方式'}
          disabled={!instruction || saving || (editing && body === instruction.body)}
          onClick={() => editing ? void saveInstruction(body) : setEditing(true)}>{editing ? <Check/> : <Pencil/>}</IconAction>}
      </div>
    </header>

    {loading && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin"/>正在读取工作方式</p>}
    {loadError && <div role="alert" className="rounded-lg bg-state-failed-soft p-3 text-sm text-state-failed">
      {loadError}
      <Button variant="ghost" size="xs" onClick={() => {
        if (dirty && !window.confirm('放弃未保存的改动并重新读取？')) return
        setEditing(false)
        setEditedProposal(null)
        void load()
      }}>重新读取</Button>
    </div>}
    {instruction && <>
      <div className="background-style-doc" data-editing={editing}>
        {editing ? <textarea ref={editor} value={body} readOnly={saving} autoFocus rows={1} maxLength={maxChars}
          aria-label="工作方式正文" placeholder="写下这个工作区的工作方式"
          onChange={event => setBody(event.target.value)} onKeyDown={event => {
            if (event.nativeEvent.isComposing || saving) return
            if (event.key === 'Escape') {event.stopPropagation(); cancelEdit()}
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && body !== instruction.body) {
              event.preventDefault()
              void saveInstruction(body)
            }
          }}/>
          : instruction.body.trim() ? <MarkdownContent content={instruction.body}/> : <p className="text-muted-foreground">还没有设置工作方式。</p>}
      </div>
      {editing ? <p className="background-style-meta tabular-nums">{saving ? '正在保存' : `${body.length}/${maxChars}`}</p>
        : instruction.instruction_version != null && <div className="background-style-meta">
        {instruction.updated_at != null && <span>{parseEventTime(instruction.updated_at)?.toLocaleDateString('zh-CN')}</span>}
        {instruction.source && <span>{CHANGE_SOURCE[instruction.source]}</span>}
        <span>修改从下一次运行生效，进行中的任务保留原版本</span>
      </div>}
    </>}

    {proposals.length > 0 && <div className="space-y-2 pt-1">
      {proposals.map(proposal => {
        const sourceTitle = titleOf(proposal.session_id)
        return <article key={proposal.id} className="background-review-card">
        <header className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Wand className="size-4 text-signal"/>
          <h3 className="text-sm font-semibold">Agent 建议补充</h3>
          <span className="text-xs text-muted-foreground">{sourceTitle ? `来自「${sourceTitle}」` : `基于 v${proposal.base_version}`}</span>
        </header>
        {proposal.rationale && <p className="text-sm text-muted-foreground">{proposal.rationale}</p>}
        {editedProposal?.id === proposal.id
          ? <Textarea value={editedProposal.body} autoFocus rows={6} maxLength={maxChars} aria-label="编辑 Agent 建议"
              disabled={proposalBusy === proposal.id} onChange={event => setEditedProposal({id: proposal.id, body: event.target.value})}/>
          : <DocumentChange before={instruction?.body ?? ''} after={proposal.body}/>}
        {!readonly && <div className="flex flex-wrap gap-2">
          {editedProposal?.id === proposal.id ? <>
            <Button size="sm" disabled={proposalBusy !== null} onClick={() => void acceptProposal(proposal.id, editedProposal.body)}>保存并采纳</Button>
            <Button size="sm" variant="ghost" disabled={proposalBusy !== null} onClick={() => setEditedProposal(null)}>取消编辑</Button>
          </> : <>
            <Button size="sm" disabled={proposalBusy !== null || editing} onClick={() => void acceptProposal(proposal.id)}>接受</Button>
            <Button size="sm" variant="ghost" disabled={proposalBusy !== null || editing}
              onClick={() => setEditedProposal({id: proposal.id, body: proposal.body})}>改一下再接受</Button>
            <Button size="sm" variant="ghost" disabled={proposalBusy !== null || editing} onClick={() => void rejectProposal(proposal.id)}>忽略</Button>
          </>}
        </div>}
      </article>
      })}
    </div>}

    <Dialog open={templatesOpen} onOpenChange={setTemplatesOpen}>
      <DialogContent className="max-h-[min(34rem,85dvh)] overflow-y-auto">
      <DialogTitle>工作方式模板</DialogTitle>
      <DialogDescription className="sr-only">保存和应用工作方式模板</DialogDescription>
      <div className="mt-3 space-y-2">
        <div className="flex gap-2">
          <Input value={templateName} placeholder="模板名称" aria-label="模板名称" disabled={readonly} onChange={event => setTemplateName(event.target.value)}/>
          <Button type="button" size="sm" variant="secondary" disabled={readonly || !templateName.trim()} onClick={() => void saveTemplate()}>另存当前</Button>
        </div>
        {templates.length === 0 && <p className="text-meta text-muted-foreground">还没有模板。</p>}
        <ul>{templates.map(template => <li key={template.id} className="flex items-center gap-2 py-2">
          <span className="mr-auto min-w-0 truncate" title={template.body}>{template.name}</span>
          <Button type="button" size="xs" variant="secondary" disabled={readonly || dirty} onClick={() => void applyTemplate(template.id)}>应用</Button>
          <Button type="button" size="xs" variant="ghost" onClick={() => void deleteTemplate(template.id)}>删除</Button>
        </li>)}</ul>
      </div>
      </DialogContent>
    </Dialog>

    <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
      <DialogContent className="max-h-[min(44rem,85dvh)] gap-3 overflow-hidden rounded-[18px] sm:max-w-3xl"
        onInteractOutside={event => event.preventDefault()}>
        <DialogTitle>工作方式版本历史</DialogTitle>
        <DialogDescription>恢复旧内容会发布为新版本。</DialogDescription>
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto sm:flex-row">
          <div className="min-w-28 shrink-0 space-y-1">
            {versions.map(version => <Button key={version.version} type="button" size="sm" className="w-full justify-start"
              variant={selectedVersion === version.version ? 'secondary' : 'ghost'} onClick={() => setSelectedVersion(version.version)}>
              v{version.version} <span className="text-xs text-faint">{new Date(version.created_at).toLocaleDateString()}</span>
            </Button>)}
            {nextBefore != null && <Button size="xs" variant="ghost" disabled={historyLoading} onClick={() => void loadHistory(nextBefore)}>更早版本</Button>}
          </div>
          <div className="min-w-0 flex-1 sm:overflow-y-auto">
            {historyLoading && <p role="status" className="text-sm text-muted-foreground">正在读取版本历史…</p>}
            {historyError && <p role="alert" className="text-sm text-state-failed">{historyError} <Button size="xs" onClick={() => void loadHistory()}>重试</Button></p>}
            {!historyLoading && !historyError && !selected && <p className="text-sm text-muted-foreground">还没有已发布版本。</p>}
            {selected && <>
              <p className="mb-2 text-xs text-muted-foreground">v{selected.version} · {CHANGE_SOURCE[selected.source]}
                {selected.version === instruction?.instruction_version ? ' · 当前版本' : ` · 与当前 v${instruction?.instruction_version ?? '—'} 的差异`}</p>
              <div className="rounded-xl bg-muted px-3 py-2">
                {selected.version === instruction?.instruction_version
                  ? <p className="whitespace-pre-wrap wrap-anywhere text-sm">{selected.body || '（空）'}</p>
                  : <DocumentChange before={selected.body} after={instruction?.body ?? ''}/>}
              </div>
            </>}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setHistoryOpen(false)}>关闭</Button>
          {selected && <Button disabled={readonly || !instruction || dirty || saving || selected.version === instruction.instruction_version}
            onClick={() => void saveInstruction(selected.body, true)}>恢复为新版本</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </section>
}
