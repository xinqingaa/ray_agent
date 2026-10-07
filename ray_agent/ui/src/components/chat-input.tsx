'use client'

import {useState, useEffect, useRef, useMemo, useCallback, useId, useLayoutEffect, forwardRef, useImperativeHandle, type ReactNode} from 'react'
import {cn, formatFileSize} from '@/lib/utils'
import {ScrollArea, ScrollBar} from '@/components/ui/scroll-area'
import {Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle} from '@/components/ui/item'
import {Avatar, AvatarGroupCount} from '@/components/ui/avatar'
import {ArrowUp, FileText, Loader2, Paperclip, Pause, XCircle} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {Popover, PopoverAnchor, PopoverContent} from '@/components/ui/popover'
import {PlusCommandMenu, SlashCommandList} from '@/components/input-command-menu'
import {fileApi} from '@/lib/api/file'
import {projectApi} from '@/lib/api/project'
import {classifyUpload} from '@/lib/project-upload'
import type {FileInfo} from '@/lib/api/types'
import {toast} from 'sonner'
import {ProjectPicker} from '@/components/project-picker'
import {useProjects} from '@/providers/projects-provider'
import {useRouter} from 'next/navigation'
import type {ProjectView} from '@/lib/api/types'
import {commandById, matchingCommands, type CommandContext, type CommandHost, type InputCommand} from '@/lib/commands'
import {clearDraft, readDraft, writeDraft, DRAFT_CHANGED} from '@/lib/drafts'
import {recoverSubmission, UncertainSubmissionError} from '@/lib/send-recovery'
import {findSlashTrigger, removeSlashFragment, type SlashFragment} from '@/lib/slash-trigger'
import {ModelPicker, type ModelSelection} from '@/components/model-picker'
interface ChatInputProps {
  className?: string
  onInputValueChange?: (value: string) => void
  onSend?: (message: string, files: FileInfo[], options?: {mode?: 'plan' | 'normal'; model?: string; reasoning?: string}) => Promise<void>
  savedModel?: string | null
  savedReasoning?: string | null
  runModel?: string | null
  runReasoning?: string | null
  /** 运行中或消息刚送出时，发送位改为暂停。停止中按钮禁用，转圈留在时间线那一句。 */
  pause?: false | 'ready' | 'stopping'
  onPause?: () => void
  disabled?: boolean
  /** 当前会话 ID，上传附件时会关联到该会话 */
  sessionId?: string | null
  placeholder?: string
  /** 发送按钮左侧，例如上下文环 */
  accessory?: ReactNode | ((context: CommandContext) => ReactNode)
  draftScope?: string
  /** 页面状态。上传中与文件选择由输入框补进命令上下文。 */
  commandHost?: CommandHost
  projectsEnabled?: boolean
  projectBindable?: boolean
  selectedProject?: ProjectView | null
  onProjectSelect?: (project: ProjectView | null) => void
}

const EMPTY_HOST: CommandHost = {
  hasSession: false,
  hasRuns: false,
  runStatus: 'idle',
  waitingApproval: false,
  waitingReply: false,
  submitting: false,
  compacting: false,
  actions: {compact: () => {}},
  projectsEnabled: false,
  projectBindable: false,
}

export interface ChatInputRef {
  setInputText: (text: string) => void
  getInputValue: () => string
  getFiles: () => FileInfo[]
}

export const ChatInput = forwardRef<ChatInputRef, ChatInputProps>(
  ({ className, onInputValueChange, onSend, pause = false, onPause, disabled = false, sessionId, placeholder = '分配一个任务或提问任何问题...', accessory, draftScope, commandHost = EMPTY_HOST, projectsEnabled = false, projectBindable = false, selectedProject = null, savedModel = null, savedReasoning = null, runModel = null, runReasoning = null }, ref) => {
    const [files, setFiles] = useState<FileInfo[]>([])
    const [uploading, setUploading] = useState(false)
    const [sending, setSending] = useState(false)
    const [inputValue, setInputValue] = useState('')
    const [planMode, setPlanMode] = useState(false)
    const [slash, setSlash] = useState<SlashFragment | null>(null)
    const workspace = useProjects()
    const router = useRouter()
    const [projectPickerOpen, setProjectPickerOpen] = useState(false)
    const [activeId, setActiveId] = useState<string | null>(null)
    const fileInputRef = useRef<HTMLInputElement>(null)
    const textareaRef = useRef<HTMLTextAreaElement>(null)
    const composingRef = useRef(false)
    const pendingCursor = useRef<number | null>(null)
    /** Esc 或执行命令后，同一片段不要被随后的 keyup 重新打开。 */
    const dismissedRef = useRef<SlashFragment | null>(null)
    const slashListId = useId()
    const localDraftId = useId()
    const scope = draftScope ?? (sessionId ? `session:${sessionId}` : `input:${localDraftId}`)
    const [loadedScope, setLoadedScope] = useState<string | null>(null)
    const [uncertain, setUncertain] = useState(false)
    const [modelChoice, setModelChoice] = useState<ModelSelection | null>(null)
    useEffect(() => {
      const draft = readDraft(scope)
      setInputValue(draft.text)
      setFiles(draft.files)
      setPlanMode(draft.planMode)
      setUncertain(!!draft.submission)
      setLoadedScope(scope)
    }, [scope])
    useEffect(() => {
      const check = (event: Event) => {
        if ((event as CustomEvent).detail === scope) setUncertain(!!readDraft(scope).submission)
      }
      window.addEventListener(DRAFT_CHANGED, check)
      return () => window.removeEventListener(DRAFT_CHANGED, check)
    }, [scope])
    useEffect(() => {
      if (loadedScope === scope) writeDraft(scope, {text: inputValue, files, planMode})
    }, [scope, loadedScope, inputValue, files, planMode])

    const blocked = disabled || sending || commandHost.compacting || uncertain
    const [wasBlocked, setWasBlocked] = useState(blocked)
    if (blocked !== wasBlocked) {
      setWasBlocked(blocked)
      if (blocked) setSlash(null)
    }

    const openFilePicker = useCallback(() => {
      fileInputRef.current?.click()
    }, [])

    const togglePlan = useCallback(() => {
      setPlanMode((prev) => !prev)
    }, [])

    const resolvedProjectsEnabled = commandHost.projectsEnabled ?? projectsEnabled
    const resolvedProjectBindable = commandHost.projectBindable ?? projectBindable

    const commandContext = useMemo<CommandContext>(() => ({
      hasSession: commandHost.hasSession,
      hasRuns: commandHost.hasRuns,
      runStatus: commandHost.runStatus,
      waitingApproval: commandHost.waitingApproval,
      waitingReply: commandHost.waitingReply,
      submitting: commandHost.submitting || sending || uncertain,
      uploading,
      compacting: commandHost.compacting,
      planMode,
      projectsEnabled: resolvedProjectsEnabled,
      projectBindable: resolvedProjectBindable,
      actions: {
        openFilePicker,
        togglePlan,
        openProjectPicker: () => workspace ? workspace.openProject() : setProjectPickerOpen(true),
        compact: commandHost.actions.compact,
      },
    }), [
      workspace,
      commandHost.hasSession,
      commandHost.hasRuns,
      commandHost.runStatus,
      commandHost.waitingApproval,
      commandHost.waitingReply,
      commandHost.submitting,
      commandHost.compacting,
      commandHost.actions.compact,
      sending,
      uncertain,
      uploading,
      planMode,
      resolvedProjectsEnabled,
      resolvedProjectBindable,
      openFilePicker,
      togglePlan,
    ])

    const slashOpen = slash != null && !blocked
    const matched = useMemo(
      () => (slashOpen && slash ? matchingCommands(slash.query, {projectsEnabled: resolvedProjectsEnabled}) : []),
      [slashOpen, slash, resolvedProjectsEnabled],
    )
    const resolvedActiveId = matched.some((command) => command.id === activeId)
      ? activeId
      : matched[0]?.id ?? null
    const updateSlash = (text: string, cursor: number, composing: boolean) => {
      if (composing || blocked) {
        setSlash((prev) => prev == null ? prev : null)
        return
      }
      const next = findSlashTrigger(text, cursor, false)
      if (next && dismissedRef.current && sameFragment(dismissedRef.current, next)) {
        setSlash((prev) => prev == null ? prev : null)
        return
      }
      dismissedRef.current = null
      setSlash((prev) => sameFragment(prev, next) ? prev : next)
    }

    const syncFromTextarea = (el: HTMLTextAreaElement, composing = composingRef.current) => {
      updateSlash(el.value, el.selectionStart ?? el.value.length, composing)
    }

    const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value
      setInputValue(value)
      onInputValueChange?.(value)
      syncFromTextarea(e.target)
    }

    useImperativeHandle(ref, () => ({
      setInputText: (text: string) => {
        setInputValue(text)
        onInputValueChange?.(text)
        updateSlash(text, text.length, false)
        textareaRef.current?.focus()
      },
      getInputValue: () => inputValue,
      getFiles: () => files,
    }))

    useLayoutEffect(() => {
      const pos = pendingCursor.current
      if (pos == null) return
      pendingCursor.current = null
      const node = textareaRef.current
      if (!node) return
      node.focus()
      node.setSelectionRange(pos, pos)
    }, [inputValue])

    useLayoutEffect(() => {
      const node = textareaRef.current
      if (!node) return
      const apply = () => {
        if (!slashOpen || !resolvedActiveId) {
          node.removeAttribute('aria-controls')
          node.removeAttribute('aria-activedescendant')
          return
        }
        const root = document.getElementById(slashListId)
        const list = root?.querySelector<HTMLElement>('[role="listbox"]')
        const selected = root?.querySelector<HTMLElement>(`[cmdk-item][data-value="${CSS.escape(resolvedActiveId)}"]`)
        if (list?.id) node.setAttribute('aria-controls', list.id)
        else node.removeAttribute('aria-controls')
        if (selected?.id) node.setAttribute('aria-activedescendant', selected.id)
        else node.removeAttribute('aria-activedescendant')
      }
      apply()
      if (!slashOpen) return
      const frame = requestAnimationFrame(apply)
      return () => cancelAnimationFrame(frame)
    }, [slashOpen, slashListId, resolvedActiveId, slash?.query])

    const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
      const selectedFiles = event.target.files
      if (!selectedFiles || selectedFiles.length === 0) {
        return
      }

      setUploading(true)

      try {
        let chosen=Array.from(selectedFiles)
        const rule=selectedProject ? await projectApi.uploadRules() : null
        const optional=new Set<string>()
        if(rule) {
          chosen=chosen.filter(file => {
            const decision=classifyUpload(file.name.normalize('NFC'),false,chosen.map(item=>item.name.normalize('NFC')),rule)
            if(decision.policy==='always' || file.size>rule.max_file_bytes){toast.error(`文件「${file.name}」已排除：${decision.reason || '超过单文件大小上限'}`);return false}
            if(decision.policy==='optional') {
              if(!window.confirm(`「${file.name}」可能包含密钥或凭据，默认不上传。确认将此文件作为项目附件上传？`))return false
              optional.add(file.name)
            }
            return true
          })
          const total=chosen.reduce((sum,file)=>sum+file.size,0)
          if(chosen.length>rule.max_files || total>rule.max_batch_bytes)throw new Error('最终待上传附件超过数量或单次大小上限，请减少材料')
        }
        const uploadPromises = chosen.map(async (file) => {
          try {
            const fileInfo = await fileApi.uploadFile({
              file,
              ...(sessionId && { session_id: sessionId }),
              ...(selectedProject && rule && {project_id:selectedProject.id,rule_version:rule.version,include_optional:optional.has(file.name)}),
            })
            return fileInfo
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : '上传失败'
            toast.error(`文件「${file.name}」上传失败: ${errorMessage}`)
            return null
          }
        })

        const uploadedFiles = (await Promise.all(uploadPromises)).filter(
          (file): file is FileInfo => file !== null
        )

        if (uploadedFiles.length > 0) {
          setFiles((prev) => [...prev, ...uploadedFiles])
          toast.success(`成功上传 ${uploadedFiles.length} 个文件`)
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : '文件上传过程中发生错误')
      } finally {
        setUploading(false)
        // 重置input，以便可以重复选择同一文件
        if (fileInputRef.current) {
          fileInputRef.current.value = ''
        }
      }
    }

    const handleRemoveFile = (fileId: string) => {
      setFiles((prev) => prev.filter((file) => file.id !== fileId))
    }

    const handleSend = async () => {
      if (blocked || uploading) return
      const trimmedMessage = inputValue.trim()
      
      // 验证消息不为空
      if (!trimmedMessage) {
        toast.error('请输入消息内容')
        textareaRef.current?.focus()
        return
      }

      // 如果提供了 onSend 回调，使用它
      if (onSend) {
        setSending(true)
        try {
          await onSend(trimmedMessage, files, {
            mode: planMode ? 'plan' : 'normal',
            ...(modelChoice ? {model: modelChoice.model, reasoning: modelChoice.reasoning} : {}),
          })
          clearDraft(scope)
          // 发送成功后清空输入框和文件列表
          setInputValue('')
          setFiles([])
          setPlanMode(false)
          setSlash(null)
          onInputValueChange?.('')
        } catch (error) {
          // 错误处理由 onSend 内部处理
          if (error instanceof UncertainSubmissionError) setUncertain(true)
          console.error('发送消息失败:', error)
        } finally {
          setSending(false)
        }
      }
    }

    const runSlash = (command: InputCommand) => {
      if (!slashOpen || !slash) return
      if (!command.available(commandContext).available) return
      const cursor = textareaRef.current?.selectionStart ?? inputValue.length
      const next = removeSlashFragment(inputValue, cursor, slash)
      pendingCursor.current = next.cursor
      dismissedRef.current = slash
      setInputValue(next.text)
      onInputValueChange?.(next.text)
      setSlash(null)
      command.run(commandContext)
    }

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.nativeEvent.isComposing || composingRef.current) return

      if (slashOpen) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          if (matched.length > 0) {
            e.preventDefault()
            const current = matched.findIndex((command) => command.id === resolvedActiveId)
            const delta = e.key === 'ArrowDown' ? 1 : -1
            const next = matched[(current + delta + matched.length) % matched.length]
            if (next) setActiveId(next.id)
          }
          return
        }
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          dismissedRef.current = slash
          setSlash(null)
          return
        }
        if (e.key === 'Tab' && matched.length > 0) {
          e.preventDefault()
          const command = matched.find((item) => item.id === resolvedActiveId)
          if (!command || !command.available(commandContext).available) return
          runSlash(command)
          return
        }
      }

      if (e.key !== 'Enter') return
      if (e.altKey) {
        e.preventDefault()
        const el = textareaRef.current
        if (!el) return
        const start = el.selectionStart
        const end = el.selectionEnd
        const next = `${inputValue.slice(0, start)}\n${inputValue.slice(end)}`
        setInputValue(next)
        onInputValueChange?.(next)
        requestAnimationFrame(() => {
          el.selectionStart = el.selectionEnd = start + 1
          updateSlash(next, start + 1, false)
        })
        return
      }
      e.preventDefault()
      if (slashOpen) {
        const command = matched.find((item) => item.id === resolvedActiveId)
        if (!command || !command.available(commandContext).available) return
        runSlash(command)
        return
      }
      void handleSend()
    }

    const showPause = pause === 'stopping' || pause === 'ready' || (sending && !!onPause)

    return (
    <Popover open={slashOpen} onOpenChange={(open) => { if (!open) setSlash(null) }}>
    <div className={cn('flex flex-col bg-card w-full rounded-2xl py-3 border', className)}>
      {uncertain && !sending && !commandHost.submitting && (
        <div role="status" className="mx-4 mb-2 space-y-2 text-meta text-state-waiting">
          <p>正在确认是否发送成功，文字、附件和模式已保留。请检查结果或核对对话历史。</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={async () => {
              const id = sessionId ?? readDraft(scope).sessionId
              if (!id) return
              try {
                if (await recoverSubmission(scope, id)) {
                  clearDraft(scope); setInputValue(''); setFiles([]); setPlanMode(false); setUncertain(false)
                  toast.success('已确认消息受理，可以继续查看运行')
                  window.location.assign(`/sessions/${id}`)
                }
              } catch (error) { toast.error(error instanceof Error ? error.message : '核对失败') }
            }}>检查发送结果</Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => {
              if(!window.confirm('仅在已核对对话、确认未发送时重发。若原消息已受理，重发可能重复执行。是否允许手动重发？'))return
              writeDraft(scope, {submission: undefined}); setUncertain(false)
              toast.message('已允许手动重发，请确认历史中没有这条消息后发送')
            }}>确认未受理，允许重发</Button>
          </div>
        </div>
      )}
      {/* 顶部的文件列表 */}
      {files.length > 0 && (
        <div className="w-full px-4 mb-1">
          <ScrollArea className="w-full whitespace-nowrap">
            <div className="flex w-max space-x-4 pb-4">
              {files.map((file) => (
                <Item
                  key={file.id}
                  variant="muted"
                  className="p-2 flex-shrink-0 gap-2"
                >
                  {/* 左侧文件图标 */}
                  <ItemMedia>
                    <Avatar className="size-8">
                      <AvatarGroupCount>
                        <FileText/>
                      </AvatarGroupCount>
                    </Avatar>
                  </ItemMedia>
                  {/* 文件信息 */}
                  <ItemContent className="gap-0">
                    <ItemTitle className="text-sm text-foreground">{file.filename}</ItemTitle>
                    <ItemDescription className="text-xs">
                      {file.extension} · {formatFileSize(file.size)}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      className="cursor-pointer"
                      onClick={() => handleRemoveFile(file.id)}
                      disabled={blocked || uploading}
                      aria-label={`移除 ${file.filename}`}
                    >
                      <XCircle/>
                    </Button>
                  </ItemActions>
                </Item>
              ))}
            </div>
            <ScrollBar orientation="horizontal"/>
          </ScrollArea>
        </div>
      )}
      {/* 中间输入框 */}
      <PopoverAnchor asChild>
      <div className="px-4 mb-3">
        <textarea
          ref={textareaRef}
          rows={2}
          value={inputValue}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onKeyUp={(event) => {
            if (event.nativeEvent.isComposing || composingRef.current) return
            if (event.key === 'Enter' || event.key === 'Tab' || event.key === 'Escape') return
            if (event.currentTarget.selectionStart == null) return
            syncFromTextarea(event.currentTarget)
          }}
          onSelect={(event) => syncFromTextarea(event.currentTarget)}
          onCompositionStart={() => {
            composingRef.current = true
            setSlash(null)
          }}
          onCompositionEnd={(event) => {
            composingRef.current = false
            syncFromTextarea(event.currentTarget, false)
          }}
          placeholder={placeholder}
          aria-expanded={slashOpen}
          aria-autocomplete={slashOpen ? 'list' : undefined}
          role={slashOpen ? 'combobox' : undefined}
          className="scrollbar-hide outline-none w-full text-sm resize-none h-[46px] min-h-[40px]"
          disabled={blocked}
        />
      </div>
      </PopoverAnchor>
      {/* 底部上传&发送按钮 */}
      <footer className="flex flex-row items-center justify-between w-full px-3">
        {/* 命令菜单 */}
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleFileSelect}
            disabled={uploading}
          />
          <PlusCommandMenu context={commandContext}/>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="添加附件" title="添加附件"
            disabled={!commandById('upload')?.available(commandContext).available}
            onClick={() => commandById('upload')?.run(commandContext)}>
            <Paperclip className="size-4"/>
          </Button>
          {!workspace && <ProjectPicker hideTrigger open={projectPickerOpen} onOpenChange={setProjectPickerOpen} onSelect={project => {if (!project) return; router.push(`/projects/${project.id}`)}}/>}
          {planMode && (
            <button
              type="button"
              onClick={() => setPlanMode(false)}
              className="inline-flex h-7 max-w-full items-center gap-1 rounded-md border border-signal/30 bg-signal-soft/50 px-2 text-xs font-medium text-signal outline-none hover:bg-signal-soft focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="truncate">计划模式</span>
              <XCircle className="size-3.5 shrink-0" aria-hidden/>
              <span className="sr-only">，点击移除</span>
            </button>
          )}
        </div>
        {/* 发送/暂停按钮 */}
        <div className="flex items-center gap-1">
          <ModelPicker
            sessionId={sessionId}
            savedModel={savedModel}
            savedReasoning={savedReasoning}
            runModel={runModel}
            runReasoning={runReasoning}
            onSelection={setModelChoice}
          />
          {typeof accessory === 'function' ? accessory(commandContext) : accessory}
          <Button
            type="button"
            variant="outline"
            className="rounded-full w-8 h-8 cursor-pointer"
            onClick={showPause ? onPause : handleSend}
            disabled={showPause ? pause === 'stopping' || !onPause : blocked || uploading || !inputValue.trim()}
            aria-label={showPause ? (pause === 'stopping' ? '停止中' : '暂停') : '发送'}
            title={showPause ? (pause === 'stopping' ? '停止中' : '暂停') : '发送'}
          >
            {showPause ? (
              <Pause className="size-3.5 fill-current"/>
            ) : sending ? (
              <Loader2 className="size-4 animate-spin"/>
            ) : (
              <ArrowUp/>
            )}
          </Button>
        </div>
      </footer>
    </div>
    <PopoverContent
      align="start"
      side="top"
      sideOffset={8}
      collisionPadding={8}
      className="w-[min(20rem,calc(100vw-2rem))] p-0"
      onOpenAutoFocus={(event) => event.preventDefault()}
      onCloseAutoFocus={(event) => event.preventDefault()}
    >
      <div id={slashListId}>
        {slashOpen && slash && (
          <SlashCommandList
            query={slash.query}
            context={commandContext}
            activeId={resolvedActiveId}
            onActiveIdChange={setActiveId}
            onRun={runSlash}
          />
        )}
      </div>
    </PopoverContent>
    </Popover>
    )
  }
)

function sameFragment(prev: SlashFragment | null, next: SlashFragment | null): boolean {
  if (prev === next) return true
  if (!prev || !next) return false
  return prev.start === next.start && prev.end === next.end && prev.query === next.query
}

ChatInput.displayName = 'ChatInput'
