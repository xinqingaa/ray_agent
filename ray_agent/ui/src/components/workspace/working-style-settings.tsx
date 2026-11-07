import {useEffect, useState} from 'react'
import {Loader2} from 'lucide-react'
import {toast} from 'sonner'
import {Button} from '@/components/ui/button'
import {Input} from '@/components/ui/input'
import {ScrollArea} from '@/components/ui/scroll-area'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {Switch} from '@/components/ui/switch'
import {Textarea} from '@/components/ui/textarea'
import {instructionApi} from '@/lib/api/instruction'
import {ApiError} from '@/lib/api/fetch'
import type {InstructionProposalView, InstructionView, TemplateView, WorkspaceItem} from '@/lib/api/types'
import {reportWorkspaceError} from '@/lib/workspace-mutation'
import {describeWorkspace} from '@/lib/workspace-state'
import {useWorkspaces} from '@/providers/workspaces-provider'

export function WorkingStyleSettings({workspace, open, onOpenChange}: {
  workspace: WorkspaceItem
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const {upsert, refresh} = useWorkspaces()
  const condition = describeWorkspace(workspace)
  const readonly = condition.archived || condition.deleting
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [instruction, setInstruction] = useState<InstructionView | null>(null)
  const [body, setBody] = useState('')
  const [proposals, setProposals] = useState<InstructionProposalView[]>([])
  const [templates, setTemplates] = useState<TemplateView[]>([])
  const [templateName, setTemplateName] = useState('')
  const [proposalBusy, setProposalBusy] = useState<string | null>(null)

  const autoMemory = workspace.auto_memory_enabled === true

  const load = async () => {
    setLoading(true)
    try {
      const [current, pending, list] = await Promise.all([
        instructionApi.get(workspace.id),
        instructionApi.proposals(workspace.id, 'pending'),
        instructionApi.listTemplates(),
      ])
      setInstruction(current)
      setBody(current.body)
      setProposals(pending)
      setTemplates(list)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '读取工作方式失败')
    } finally {setLoading(false)}
  }

  useEffect(() => {
    if (open) void load()
  }, [open, workspace.id]) // eslint-disable-line react-hooks/exhaustive-deps -- 打开时拉取

  const saveInstruction = async () => {
    if (saving || readonly || !instruction) return
    setSaving(true)
    try {
      const next = await instructionApi.put(workspace.id, {body, version: workspace.version})
      setInstruction(next)
      toast.success('已保存工作方式')
    } catch (error) {
      if (error instanceof ApiError && error.code === 'conflict') reportWorkspaceError(error, '保存失败', () => void refresh())
      else toast.error(error instanceof Error ? error.message : '保存失败')
    } finally {setSaving(false)}
  }

  const toggleAutoMemory = async (enabled: boolean) => {
    if (readonly) return
    try {
      upsert(await instructionApi.setAutoMemory(workspace, enabled))
      toast.success(enabled ? '已开启自动记忆' : '已关闭自动记忆')
    } catch (error) {
      reportWorkspaceError(error, '更新自动记忆失败', () => void refresh())
    }
  }

  const acceptProposal = async (id: string) => {
    setProposalBusy(id)
    try {
      const next = await instructionApi.acceptProposal(workspace.id, id)
      setInstruction(next)
      setBody(next.body)
      setProposals(current => current.filter(item => item.id !== id))
      toast.success('已采纳提议')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '采纳失败')
      void load()
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

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-lg">
        <SheetHeader className="border-b px-4 py-3 text-left">
          <SheetTitle>工作方式</SheetTitle>
          <SheetDescription>
            描述本工作区长期有效的角色、原则与限制；新对话会读取当前版本。
          </SheetDescription>
        </SheetHeader>
        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-6 p-4">
            {loading && (
              <p className="flex items-center gap-2 text-meta text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden/>正在读取
              </p>
            )}
            {!loading && (
              <>
                <section className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-medium">正文</h3>
                    <span className="text-xs text-faint">{body.length}/{maxChars}</span>
                  </div>
                  <Textarea
                    value={body}
                    disabled={readonly || saving}
                    rows={10}
                    maxLength={maxChars}
                    placeholder="例如：只用简体中文回答；修改代码前先说明计划……"
                    aria-label="工作方式正文"
                    onChange={event => setBody(event.target.value)}
                  />
                  {!readonly && (
                    <Button type="button" size="sm" disabled={saving || body === instruction?.body} onClick={() => void saveInstruction()}>
                      {saving ? '正在保存' : '保存'}
                    </Button>
                  )}
                  {workspace.instruction_preview?.trim() && body !== workspace.instruction_preview && (
                    <p className="text-meta text-muted-foreground">当前预览：{workspace.instruction_preview}</p>
                  )}
                </section>

                <section className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
                  <div>
                    <p className="text-sm font-medium">自动记忆</p>
                    <p className="text-meta text-muted-foreground">关闭后不再从对话中自动提炼记忆。</p>
                  </div>
                  <Switch checked={autoMemory} disabled={readonly} onCheckedChange={checked => void toggleAutoMemory(checked)} aria-label="自动记忆"/>
                </section>

                {proposals.length > 0 && (
                  <section className="space-y-2">
                    <h3 className="text-sm font-medium">待确认提议</h3>
                    <ul className="space-y-2">
                      {proposals.map(proposal => (
                        <li key={proposal.id} className="rounded-lg border bg-muted/30 px-3 py-2.5">
                          {proposal.rationale && <p className="text-meta text-muted-foreground">{proposal.rationale}</p>}
                          <p className="mt-1 whitespace-pre-wrap text-sm">{proposal.body}</p>
                          {!readonly && (
                            <div className="mt-2 flex gap-2">
                              <Button type="button" size="xs" disabled={proposalBusy === proposal.id} onClick={() => void acceptProposal(proposal.id)}>采纳</Button>
                              <Button type="button" size="xs" variant="ghost" disabled={proposalBusy === proposal.id} onClick={() => void rejectProposal(proposal.id)}>拒绝</Button>
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                <section className="space-y-3">
                  <h3 className="text-sm font-medium">模板</h3>
                  <div className="flex gap-2">
                    <Input value={templateName} placeholder="模板名称" aria-label="模板名称" disabled={readonly} onChange={event => setTemplateName(event.target.value)}/>
                    <Button type="button" size="sm" variant="secondary" disabled={readonly || !templateName.trim()} onClick={() => void saveTemplate()}>另存当前</Button>
                  </div>
                  {templates.length === 0 && <p className="text-meta text-muted-foreground">还没有模板。</p>}
                  <ul className="space-y-2">
                    {templates.map(template => (
                      <li key={template.id} className="flex items-start justify-between gap-2 rounded-lg border px-3 py-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium" title={template.name}>{template.name}</p>
                          <p className="mt-0.5 line-clamp-2 text-meta text-muted-foreground">{template.body || '（空）'}</p>
                        </div>
                        <div className="flex shrink-0 flex-col gap-1">
                          <Button type="button" size="xs" variant="secondary" disabled={readonly} onClick={() => void applyTemplate(template.id)}>应用</Button>
                          <Button type="button" size="xs" variant="ghost" onClick={() => void deleteTemplate(template.id)}>删除</Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              </>
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  )
}
