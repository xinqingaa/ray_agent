import {useState, useContext, useEffect, useRef, useMemo, useCallback, useId, useLayoutEffect, forwardRef, useImperativeHandle, type ReactNode} from 'react'
import {TaskFilePicker} from '@/lib/task-file-picker'
import {cn, formatFileSize} from '@/lib/utils'
import {ScrollArea, ScrollBar} from '@/components/ui/scroll-area'
import {Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle} from '@/components/ui/item'
import {Avatar, AvatarGroupCount} from '@/components/ui/avatar'
import {ArrowUp, Eye, FileText, ListChecks, Loader2, Paperclip, Quote, Sparkles, Stop, X, XCircle} from '@/components/ui/icons'
import {Button} from '@/components/ui/button'
import {ContextMenuSurface} from '@/components/ui/context-menu'
import {menuItem, type MenuEntry} from '@/lib/context-menu-policy'
import {insertText, selectAllText} from '@/lib/text-edit'
import {Popover, PopoverAnchor, PopoverContent} from '@/components/ui/popover'
import {SlashCommandList} from '@/components/input-command-menu'
import {presetIconComponent} from '@/components/preset-picker'
import {skillsApi, SKILLS_CHANGED, type PresetItem, type Skill, type SkillSelection} from '@/lib/api/skills'
import {SkillMark} from '@/components/skill-mark'
import {isDesktop, openModelConfig} from '@/lib/platform'
import {ApiError} from '@/lib/api/fetch'
import {fileApi} from '@/lib/api/file'
import {downloadFile} from '@/lib/api/preview'
import type {FileInfo} from '@/lib/api/types'
import {toast} from 'sonner'
import {commandById, commandSearchFields, matchingCommands, type CommandContext, type CommandHost, type InputCommand} from '@/lib/commands'
import {clearDraft, draftClearedBy, readDraft, referenceKey, writeDraft, DRAFT_CHANGED, DATA_CLEARED, type DraftReference} from '@/lib/drafts'
import type {StartOptions} from '@/hooks/use-start-task'
import {recoverSubmission, UncertainSubmissionError} from '@/lib/send-recovery'
import {findSlashTrigger, matchesCommandQuery, removeSlashFragment, type SlashFragment} from '@/lib/slash-trigger'
import {VoiceInput} from '@/components/voice-input'
import {useUsagePreferences} from '@/hooks/use-usage-preferences'
import {ModelPicker, type ModelSelection} from '@/components/model-picker'
import {rememberModelPreference} from '@/lib/model-preference'
import {useImeComposition} from '@/lib/ime'
import {flashHighlight} from '@/lib/motion'
import {useDeveloperMode} from '@/hooks/use-developer-mode'
import {clipboardImages, isImageFile} from '@/lib/composer-images'
import {AttachmentThumbnail} from '@/components/preview/attachment-thumbnail'
import {FilePreviewDialog} from '@/components/preview/file-preview-dialog'
import type {FileView} from '@/lib/session-view'
interface ChatInputProps {
  className?: string
  onInputValueChange?: (value: string) => void
  onAbandonSubmission?: () => void
  onSend?: (message: string, files: FileInfo[], options?: StartOptions) => Promise<void>
  savedModel?: string | null
  savedReasoning?: string | null
  runModel?: string | null
  runReasoning?: string | null
  contextTokens?: number | null
  onModelCommitted?: () => void
  /** 运行中或消息刚送出时，发送位改为停止生成。停止中按钮禁用，转圈留在时间线那一句。 */
  pause?: false | 'ready' | 'stopping'
  onPause?: () => void
  disabled?: boolean
  autoFocus?: boolean
  workspace?: boolean
  workspaceId?: string
  /** 当前会话 ID，上传附件时会关联到该会话 */
  sessionId?: string | null
  placeholder?: string
  /** 发送按钮左侧，例如上下文环 */
  accessory?: ReactNode | ((context: CommandContext) => ReactNode)
  /** 输入框顶部附加栏（如当前锁定的场景胶囊） */
  topBanner?: ReactNode
  presets?: PresetItem[]
  activePresetId?: string | null
  onSelectPreset?: (presetId: string) => void
  draftScope?: string
  /** 页面状态。上传中与文件选择由输入框补进命令上下文。 */
  commandHost?: CommandHost
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
}

export interface ChatInputRef {
  setInputText: (text: string) => void
  getInputValue: () => string
  getFiles: () => FileInfo[]
  addFiles: (files: File[]) => void
}

export const ChatInput = forwardRef<ChatInputRef, ChatInputProps>(
  ({ className, onInputValueChange, onSend, onAbandonSubmission, pause = false, onPause, disabled = false, autoFocus = false, workspace = false, workspaceId, sessionId, placeholder = '分配一个任务或提问任何问题...', accessory, topBanner, presets = [], activePresetId = null, onSelectPreset, draftScope, commandHost = EMPTY_HOST, savedModel = null, savedReasoning = null, runModel = null, runReasoning = null, contextTokens = null, onModelCommitted }, ref) => {
    const {visibility} = useDeveloperMode()
    const pickDestination = useContext(TaskFilePicker)
    const [files, setFiles] = useState<FileInfo[]>([])
    const [missingFiles, setMissingFiles] = useState<Set<string>>(() => new Set())
    const [references, setReferences] = useState<DraftReference[]>([])
    const [referenceIssue, setReferenceIssue] = useState<{sourceId: string; message: string} | null>(null)
    const [uploading, setUploading] = useState(false)
    const [sending, setSending] = useState(false)
    const [inputValue, setInputValue] = useState('')
    const {value: usagePreferences} = useUsagePreferences()
    const [voiceBusy, setVoiceBusy] = useState(false)
    const [selectedSkill, setSelectedSkill] = useState<(SkillSelection & {name?: string}) | null>(null)
    const [skills, setSkills] = useState<Skill[]>([])
    useEffect(() => {
      let disposed = false
      let revision = 0
      setSkills([])
      const refresh = (scan = true) => {
        const current = ++revision
        skillsApi.list(workspaceId, scan).then(items => {
          if (!disposed && current === revision) setSkills(items)
        }).catch(() => {})
      }
      const reload = () => refresh(false)
      const rescan = () => refresh()
      refresh()
      window.addEventListener(SKILLS_CHANGED, reload)
      window.addEventListener('focus', rescan)
      return () => {
        disposed = true
        window.removeEventListener(SKILLS_CHANGED, reload)
        window.removeEventListener('focus', rescan)
      }
    }, [workspaceId])
    const [planMode, setPlanMode] = useState(false)
    const [slash, setSlash] = useState<SlashFragment | null>(null)
    const [keyboardStep, setKeyboardStep] = useState(0)
    const [activeId, setActiveId] = useState<string | null>(null)
    const fileInputRef = useRef<HTMLInputElement>(null)
    const textareaRef = useRef<HTMLTextAreaElement>(null)
    const skillMarkRef = useRef<HTMLButtonElement>(null)
    const [skillIndent, setSkillIndent] = useState(0)
    const skillLabel = selectedSkill?.name ?? selectedSkill?.id ?? ''
    useLayoutEffect(() => {
      const width = skillMarkRef.current?.offsetWidth ?? 0
      setSkillIndent(width > 0 ? width + 6 : 0)
    }, [skillLabel])
    const ime = useImeComposition()
    const pendingCursor = useRef<number | null>(null)
    /** Esc 或执行命令后，同一片段不要被随后的 keyup 重新打开。 */
    const dismissedRef = useRef<SlashFragment | null>(null)
    const slashListId = useId()
    const localDraftId = useId()
    const scope = draftScope ?? (sessionId ? `session:${sessionId}` : `input:${localDraftId}`)
    const [loadedScope, setLoadedScope] = useState<string | null>(null)
    const [modelIssue, setModelIssue] = useState<string | null>(null)
    const [uncertain, setUncertain] = useState(false)
    const [modelChoice, setModelChoice] = useState<ModelSelection | null>(null)
    const [preview, setPreview] = useState<FileView | null>(null)
    const mountedRef = useRef(false)
    const scopeRef = useRef(scope)
    scopeRef.current = scope
    const uploadRef = useRef<{scope: string; cancelled: boolean} | null>(null)
    const focusedScope = useRef<string | null>(null)
    useEffect(() => {mountedRef.current = true; return () => {mountedRef.current = false}}, [])
    useEffect(() => {
      const draft = readDraft(scope)
      setInputValue(draft.text)
      setFiles(draft.files)
      setMissingFiles(new Set())
      setReferences(draft.references ?? [])
      setReferenceIssue(null)
      setPlanMode(draft.planMode)
      setSelectedSkill(draft.skill ?? null)
      setPreview(null)
      setUncertain(!!draft.submission)
      setLoadedScope(scope)
      // 只有重新读回的附件需要检查。继续核对未知提交时保持原附件身份。
      let current = true
      if (!draft.submission && draft.files.length) {
        void Promise.all(draft.files.map(async file => {
          try {
            await fileApi.checkContent(file.id)
          } catch (error) {
            if (error instanceof ApiError && (error.status === 404 || error.status === 410)) return file.id
          }
        })).then(results => {
          if (current) setMissingFiles(new Set(results.filter(id => id !== undefined)))
        })
      }
      return () => {current = false}
    }, [scope])
    useEffect(() => {
      const check = (event: Event) => {
        if ((event as CustomEvent).detail !== scope) return
        const draft = readDraft(scope)
        setUncertain(!!draft.submission)
        setReferences(draft.references ?? [])
      }
      window.addEventListener(DRAFT_CHANGED, check)
      return () => window.removeEventListener(DRAFT_CHANGED, check)
    }, [scope])
    useEffect(() => {
      if (loadedScope === scope) writeDraft(scope, {text: inputValue, files, planMode, skill: selectedSkill ?? undefined, imageMode: 'auto'})
    }, [scope, loadedScope, inputValue, files, planMode, selectedSkill])

    const blocked = disabled || sending || commandHost.compacting || uncertain
    const onInputChangeRef = useRef(onInputValueChange)
    onInputChangeRef.current = onInputValueChange
    useEffect(() => {
      const cleared = (event: Event) => {
        const data = (event as CustomEvent).detail
        if (draftClearedBy(data, scope)) {
          setInputValue(''); setFiles([]); setMissingFiles(new Set()); setReferences([]); setReferenceIssue(null); setPlanMode(false); setSelectedSkill(null); setUncertain(false)
          onInputChangeRef.current?.('')
          if (uploadRef.current) uploadRef.current.cancelled = true
        }
      }
      window.addEventListener(DATA_CLEARED, cleared)
      return () => window.removeEventListener(DATA_CLEARED, cleared)
    }, [scope])
    const hasImages = files.some(isImageFile)
    const hasMissingFiles = files.some(file => missingFiles.has(file.id))

    useEffect(() => {
      if (!autoFocus || loadedScope !== scope || blocked || focusedScope.current === scope) return
      let frame = 0
      const focusOnce = () => {
        const node = textareaRef.current
        if (focusedScope.current === scope || !node || node.disabled || node.getClientRects().length === 0 || document.visibilityState === 'hidden') return
        focusedScope.current = scope
        const active = document.activeElement
        if (document.querySelector('[role="dialog"]') || (active && active !== document.body && active !== node)) return
        node.focus({preventScroll: true})
        node.setSelectionRange(node.value.length, node.value.length)
      }
      const schedule = () => {cancelAnimationFrame(frame); frame = requestAnimationFrame(focusOnce)}
      schedule()
      document.addEventListener('visibilitychange', schedule)
      return () => {cancelAnimationFrame(frame); document.removeEventListener('visibilitychange', schedule)}
    }, [autoFocus, loadedScope, scope, blocked])

    const resizeInput = useCallback(() => {
      const node = textareaRef.current
      if (!node) return
      const style = getComputedStyle(node)
      const line = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.5
      const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom)
      const minimum = line + padding
      const viewport = window.visualViewport?.height ?? window.innerHeight
      const maximum = Math.max(minimum, Math.min(line * 12 + padding, viewport * 0.35))
      node.style.height = 'auto'
      const contentHeight = node.scrollHeight
      node.style.height = `${Math.max(minimum, Math.min(contentHeight, maximum))}px`
      node.style.overflowY = contentHeight > maximum ? 'auto' : 'hidden'
    }, [])
    useLayoutEffect(resizeInput, [resizeInput, inputValue, loadedScope])
    useEffect(() => {
      const node = textareaRef.current
      if (!node) return
      let width = -1
      let frame = 0
      const schedule = () => {cancelAnimationFrame(frame); frame = requestAnimationFrame(resizeInput)}
      const observer = new ResizeObserver(entries => {
        const next = entries[0]?.contentRect.width
        if (next !== width) {width = next; schedule()}
      })
      observer.observe(node)
      const fonts = new MutationObserver(schedule)
      fonts.observe(document.documentElement, {attributes: true, attributeFilter: ['style', 'class']})
      window.addEventListener('resize', schedule)
      window.visualViewport?.addEventListener('resize', schedule)
      document.fonts?.addEventListener('loadingdone', schedule)
      return () => {
        observer.disconnect(); fonts.disconnect(); cancelAnimationFrame(frame)
        window.removeEventListener('resize', schedule)
        window.visualViewport?.removeEventListener('resize', schedule)
        document.fonts?.removeEventListener('loadingdone', schedule)
      }
    }, [resizeInput])
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
      actions: {
        openFilePicker,
        togglePlan,
        compact: commandHost.actions.compact,
      },
    }), [
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
      openFilePicker,
      togglePlan,
    ])

    const slashOpen = slash != null && !blocked
    const presetCommands = useMemo<InputCommand[]>(() => onSelectPreset ? presets.map(p => ({
      id: `preset:${p.id}`,
      surfaces: ['slash'],
      keyword: p.id,
      title: p.title,
      description: p.subtitle,
      aliases: [],
      keywords: [p.title, p.subtitle, p.id],
      icon: presetIconComponent(p.icon),
      activeTag: p.id === activePresetId ? '当前' : undefined,
      available: (context: CommandContext) => context.waitingApproval
        ? {available: false as const, reason: '请先回复审批'}
        : context.submitting
          ? {available: false as const, reason: '正在发送或核对受理状态'}
          : {available: true as const},
      run: () => onSelectPreset(p.id),
    })) : [], [presets, activePresetId, onSelectPreset])
    const presetIdSet = useMemo(() => new Set(presets.map(p => p.id)), [presets])
    const skillCommands = useMemo<InputCommand[]>(() => skills.filter(s => s.enabled && s.status !== 'missing' && !presetIdSet.has(s.id)).map(s => ({
      id: `skill:${s.id}`, surfaces: ['slash'], keyword: s.name, title: (s.same_name || s.conflict) ? `${s.name} · ${s.source?.label || s.source?.kind || '来源'}` : s.name,
      description: s.description,
      aliases: [], keywords: [s.description, s.source?.label || '', s.source?.kind || ''], icon: FileText,
      available: (context: CommandContext) => context.waitingApproval ? {available: false as const, reason: '请先回复审批'} : {available: true as const},
      run: () => setSelectedSkill({id: s.id, name: s.name, version: s.version}),
    })), [skills, presetIdSet])
    const matched = useMemo(
      () => {
        if (!slashOpen || !slash) return []
        const ops = slash.trigger === '/'
          ? matchingCommands(slash.query).filter(command => visibility.canShowCommand(command.id))
          : []
        const filteredPresets = presetCommands.filter(command => matchesCommandQuery(slash.query, commandSearchFields(command)))
        const filteredSkills = skillCommands.filter(command => matchesCommandQuery(slash.query, commandSearchFields(command)))
        return [...ops, ...filteredPresets, ...filteredSkills]
      },
      [slashOpen, slash, visibility, presetCommands, skillCommands],
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
      if (!sameFragment(slash, next)) setActiveId(null)
      setSlash((prev) => sameFragment(prev, next) ? prev : next)
    }

    const syncFromTextarea = (el: HTMLTextAreaElement, composing = ime.isComposing) => {
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
      addFiles: next => {void uploadFiles(next)},
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
        if (!slashOpen) {
          node.removeAttribute('aria-controls')
          node.removeAttribute('aria-activedescendant')
          return
        }
        const list = document.getElementById(slashListId)
        const selected = resolvedActiveId && list?.querySelector<HTMLElement>(`[role="option"][data-value="${CSS.escape(resolvedActiveId)}"]`)
        if (list?.id) node.setAttribute('aria-controls', list.id)
        else node.removeAttribute('aria-controls')
        if (selected && selected.id) node.setAttribute('aria-activedescendant', selected.id)
        else node.removeAttribute('aria-activedescendant')
      }
      apply()
      if (!slashOpen) return
      const frame = requestAnimationFrame(apply)
      return () => cancelAnimationFrame(frame)
    }, [slashOpen, slashListId, resolvedActiveId, slash?.query])

    const uploadFiles = async (selectedFiles: File[]) => {
      if (!selectedFiles.length || blocked || uploadRef.current || loadedScope !== scope) return
      const operation = {scope, cancelled: false}
      uploadRef.current = operation
      setUploading(true)

      try {
        const uploadPromises = selectedFiles.map(async (file) => {
          try {
            const fileInfo = await fileApi.uploadFile({
              file,
              ...(sessionId && { session_id: sessionId }),
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

        if (uploadedFiles.length > 0 && !operation.cancelled && readDraft(operation.scope).savedAt) {
          const next = [...readDraft(operation.scope).files, ...uploadedFiles]
          writeDraft(operation.scope, {files: next})
          if (mountedRef.current && scopeRef.current === operation.scope) {
            setFiles(next)
            toast.success(`成功上传 ${uploadedFiles.length} 个文件`)
          }
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : '文件上传过程中发生错误')
      } finally {
        uploadRef.current = null
        if (mountedRef.current) setUploading(false)
        // 重置input，以便可以重复选择同一文件
        if (fileInputRef.current) {
          fileInputRef.current.value = ''
        }
      }
    }

    const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
      const selected = Array.from(event.target.files ?? [])
      event.target.value = ''
      if (!selected.length) return
      if (pickDestination) pickDestination(selected)
      else void uploadFiles(selected)
    }
    const handlePaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const images = clipboardImages(event.clipboardData)
      if (!images.length) return
      if (!event.clipboardData.getData('text/plain')) event.preventDefault()
      if (blocked || uploadRef.current) {toast.message('当前不能添加图片，请稍后再粘贴'); return}
      void uploadFiles(images)
    }

    const handleRemoveFile = (fileId: string) => {
      setFiles((prev) => prev.filter((file) => file.id !== fileId))
    }
    // 清空草稿文字与附件。文字用可撤销的替换，因此 Cmd/Ctrl+Z 可以找回；附件不走撤销，直接移除。
    const clearComposer = () => {
      const node = textareaRef.current
      if (node && node.value) {
        const target = {kind: 'text' as const, element: node, writable: true as const}
        selectAllText(target)
        insertText(target, '')
      }
      setFiles([])
    }
    // 只列出当前能完成的项：不可用时不出现，而不是灰显
    const uploadReady = !!commandById('upload')?.available(commandContext).available
    const clearReady = !blocked && !uploading && (!!inputValue || files.length > 0)
    const composerMenu: MenuEntry[] = [
      ...(uploadReady ? [menuItem('添加附件', Paperclip, () => {commandById('upload')?.run(commandContext)})] : []),
      ...(clearReady ? [menuItem('清空', XCircle, clearComposer)] : []),
    ]
    const previewFile = (file: FileInfo) => setPreview({id: file.id, filename: file.filename, size: file.size, extension: file.extension, contentType: file.mime_type ?? file.content_type ?? '', source: 'upload', path: file.filepath ?? null})

    const handleSend = async () => {
      if (blocked || voiceBusy || uploading || uploadRef.current || hasMissingFiles) return
      let trimmedMessage = inputValue.trim()
      let skill = selectedSkill
      const shortcut = /^\/([a-z][a-z0-9-]*)(?:\s+|$)/.exec(trimmedMessage)
      const named = shortcut ? skills.filter(s => s.enabled && s.name === shortcut[1]) : []
      const found = named.find(skill => skill.preferred) ?? named.find(skill => !skill.conflict)
      if (found) {
        skill = {id: found.id, name: found.name, version: found.version}
        trimmedMessage = trimmedMessage.slice(shortcut![0].length).trim()
      }
      
      // 验证消息不为空
      if (!trimmedMessage) {
        if (skill) setSelectedSkill(skill)
        toast.error(hasImages ? '请补充要对图片做什么' : '请输入消息内容')
        textareaRef.current?.focus()
        return
      }

      // 如果提供了 onSend 回调，使用它
      if (onSend) {
        setSending(true)
        setModelIssue(null)
        setReferenceIssue(null)
        try {
          await onSend(trimmedMessage, files, {
            mode: planMode ? 'plan' : 'normal',
            image_mode: 'auto',
            skill: skill ?? undefined,
            ...(workspace && references.length ? {
              knowledge_references: references.map(({source_type, source_id, source_version}) => ({source_type, source_id, source_version})),
            } : {}),
            ...(modelChoice ? {model: modelChoice.model, reasoning: modelChoice.reasoning} : {}),
          })
          if (modelChoice) rememberModelPreference(modelChoice)
          clearDraft(scope)
          // 发送成功后清空输入框和文件列表
          setInputValue('')
          setFiles([])
          setReferences([])
          setPlanMode(false)
          setSelectedSkill(null)
          setSlash(null)
          onInputValueChange?.('')
        } catch (error) {
          // 错误处理由 onSend 内部处理
          if (error instanceof UncertainSubmissionError) setUncertain(true)
          if (error instanceof ApiError && error.details.section === 'model_connection') setModelIssue(error.message)
          if (error instanceof ApiError && error.details.section === 'knowledge_reference')
            setReferenceIssue({sourceId: String(error.details.source_id), message: error.message})
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
      if (ime.isComposingKeyDown(e)) return

      if (slashOpen) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          if (matched.length > 0) {
            e.preventDefault()
            const current = matched.findIndex((command) => command.id === resolvedActiveId)
            const delta = e.key === 'ArrowDown' ? 1 : -1
            const next = matched[(current + delta + matched.length) % matched.length]
            if (next) {setActiveId(next.id); setKeyboardStep(step => step + 1)}
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

      const caret = e.currentTarget
      const atSkill = !!selectedSkill && !slashOpen && caret.selectionStart === 0 && caret.selectionEnd === 0
      if (atSkill && e.key === 'ArrowLeft') {e.preventDefault(); skillMarkRef.current?.focus(); return}
      if (atSkill && e.key === 'Backspace') {e.preventDefault(); setSelectedSkill(null); return}

      if (e.key !== 'Enter') return
      if (e.shiftKey || e.altKey) {
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
      if (e.repeat || voiceBusy) return
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
    <Popover open={slashOpen} onOpenChange={(open) => {if (!open) {dismissedRef.current = slash; setSlash(null)}}}>
    <div data-chat-composer className={cn('@container/composer flex w-full flex-col rounded-[18px] border bg-background py-2.5 shadow-(--paper-shadow) focus-within:border-ring/45', className)}>
      {modelIssue && <div role="alert" className="mx-4 mb-2 flex flex-wrap items-center gap-x-2 text-meta text-state-failed">
        <span>{modelIssue}</span>
        {isDesktop() && <Button type="button" variant="ghost" size="xs" onClick={() => void openModelConfig()
          .catch(error => toast.error(error instanceof Error ? error.message : '无法打开模型配置'))}>打开模型配置</Button>}
      </div>}
      {uncertain && !sending && !commandHost.submitting && (
        <div role="status" className="mx-4 mb-2 space-y-2 text-meta text-state-waiting">
          <p>正在确认是否发送成功，文字、附件和模式已保留。请检查结果或核对对话历史。</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={async () => {
              const id = sessionId ?? readDraft(scope).sessionId
              if (!id) return
              try {
                if (await recoverSubmission(scope, id)) {
                  clearDraft(scope); setInputValue(''); setFiles([]); setPlanMode(false); setSelectedSkill(null); setUncertain(false)
                  toast.success('已确认消息受理，可以继续查看运行')
                  window.location.assign(`/sessions/${id}`)
                }
              } catch (error) { toast.error(error instanceof Error ? error.message : '核对失败') }
            }}>检查发送结果</Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => {
              if(!window.confirm('仅在已核对对话、确认未发送时重发。若原消息已受理，重发可能重复执行。是否允许手动重发？'))return
              writeDraft(scope, {submission: undefined}); setUncertain(false)
              onAbandonSubmission?.()
              toast.message('已允许手动重发，请确认历史中没有这条消息后发送')
            }}>确认未受理，允许重发</Button>
          </div>
        </div>
      )}
      {workspace && references.length > 0 && <div aria-label="知识引用" className="mx-4 mb-2 flex min-w-0 flex-wrap gap-1.5">
        {references.map(ref => <span key={referenceKey(ref)}
          className={cn('inline-flex max-w-full items-center gap-1.5 rounded-lg border bg-muted/45 px-2 py-1 text-xs',
            referenceIssue?.sourceId === ref.source_id && 'border-state-failed/50 text-state-failed')}>
          <Quote className="size-3.5 shrink-0 text-signal" aria-hidden/>
          <span className="min-w-0 truncate" title={ref.label}>{ref.label}</span>
          <span className="shrink-0 text-faint">v{ref.source_version}</span>
          {ref.location && <span className="max-w-36 truncate text-faint">{ref.location}</span>}
          <Button type="button" size="icon-xs" variant="ghost" aria-label={`移除引用 ${ref.label}`} disabled={blocked}
            onClick={() => {
              writeDraft(scope, {references: references.filter(item => referenceKey(item) !== referenceKey(ref))})
              if (referenceIssue?.sourceId === ref.source_id) setReferenceIssue(null)
            }}><X/></Button>
        </span>)}
      </div>}
      {referenceIssue && <p role="alert" className="mx-4 mb-2 text-xs text-state-failed">{referenceIssue.message}。移除该引用或回到知识页重新选择。</p>}
      {/* 顶部的文件列表 */}
      {files.length > 0 && (
        <div className="w-full px-4 mb-1">
          <ScrollArea className="w-full whitespace-nowrap">
            <div className="flex w-max items-start gap-3 pb-2">
              {files.map((file) => isImageFile(file) && !missingFiles.has(file.id) ? (
                <div key={file.id} className="group relative shrink-0 rounded-lg">
                  <button type="button" aria-label={`查看图片 ${file.filename}`} className="block max-w-full rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={event => {
                    event.currentTarget.focus({preventScroll: true})
                    previewFile(file)
                  }}>
                    <AttachmentThumbnail id={file.id} filename={file.filename}/>
                  </button>
                  <div className="pointer-events-none absolute right-1 top-1 flex gap-1 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100">
                    <Button type="button" variant="secondary" size="icon-xs" aria-label={`预览 ${file.filename}`} title="预览图片" className="cursor-pointer bg-background/95 shadow-sm" onClick={event => {
                      event.currentTarget.focus({preventScroll: true})
                      previewFile(file)
                    }}>
                      <Eye className="size-3.5"/>
                    </Button>
                    <Button type="button" variant="secondary" size="icon-xs" aria-label={`移除 ${file.filename}`} title="移除图片" className="cursor-pointer bg-background/95 shadow-sm" disabled={blocked || uploading} onClick={() => handleRemoveFile(file.id)}>
                      <X className="size-3.5"/>
                    </Button>
                  </div>
                </div>
              ) : (
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
                    <ItemDescription className={cn('text-xs', missingFiles.has(file.id) && 'text-state-failed')}>
                      {missingFiles.has(file.id) ? '已失效，请移除后重新添加' : `${file.extension} · ${formatFileSize(file.size)}`}
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
      {uploading && <p role="status" className="mx-4 mb-2 flex items-center gap-2 text-meta text-muted-foreground"><Loader2 className="size-3.5 animate-spin"/>正在上传附件</p>}
      {(topBanner || planMode) && <div className="mx-3.5 mb-1.5 flex flex-wrap items-center gap-1.5">
        {topBanner}
        {planMode && <button type="button" disabled={blocked} aria-label="取消计划模式" title="下一次发送以计划模式运行"
          onClick={() => {
            setPlanMode(false)
            textareaRef.current?.focus({preventScroll: true})
          }}
          className="inline-flex h-7 items-center gap-1.5 rounded-full border border-signal/25 bg-signal-soft/75 pl-2.5 pr-2 text-xs font-medium text-signal outline-none transition-colors duration-(--motion-fast) hover:bg-signal-soft focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
          <ListChecks className="size-3.5" aria-hidden/>计划模式<X className="size-3" aria-hidden/>
        </button>}
      </div>}
      {/* 中间输入框 */}
      <PopoverAnchor asChild>
      <ContextMenuSurface items={composerMenu} includeEditing><div className="relative mb-1.5 px-3.5">
        {selectedSkill && <SkillMark ref={skillMarkRef} name={selectedSkill.name ?? selectedSkill.id} skillId={selectedSkill.id} version={selectedSkill.version} workspaceId={workspaceId} className="absolute left-3.5 top-0 z-10" onRemove={blocked ? undefined : () => setSelectedSkill(null)} onExit={() => {const node = textareaRef.current; node?.focus(); node?.setSelectionRange(0, 0)}}/>}
        <textarea
          ref={textareaRef}
          rows={1}
          value={inputValue}
          style={selectedSkill ? {textIndent: skillIndent} : undefined}
          onChange={handleInputChange}
          onPaste={handlePaste}
          onKeyDown={handleKeyDown}
          onKeyUp={(event) => {
            if (ime.isComposingKeyUp(event)) return
            if (event.key === 'Enter' || event.key === 'Tab' || event.key === 'Escape') return
            if (event.currentTarget.selectionStart == null) return
            syncFromTextarea(event.currentTarget)
          }}
          onSelect={(event) => syncFromTextarea(event.currentTarget)}
          onCompositionStart={() => {
            ime.onCompositionStart()
            setSlash(null)
          }}
          onCompositionEnd={(event) => {
            ime.onCompositionEnd()
            syncFromTextarea(event.currentTarget, false)
          }}
          placeholder={placeholder}
          title={voiceBusy ? '录音时 Enter 完成，Esc 取消' : 'Enter 发送，Shift + Enter 换行'}
          aria-label="任务输入"
          aria-description={planMode ? '下一次发送以计划模式运行' : undefined}
          aria-expanded={slashOpen}
          aria-autocomplete={slashOpen ? 'list' : undefined}
          role={slashOpen ? 'combobox' : undefined}
          className="block min-h-[1.625em] w-full resize-none text-sm leading-relaxed outline-none"
          disabled={blocked}
        />
      </div></ContextMenuSurface>
      </PopoverAnchor>
      {/* 底部上传&发送按钮 */}
      <footer className="composer-actions flex min-w-0 items-end justify-between gap-1 px-2.5">
        {/* 命令菜单 */}
        <div className="composer-input-actions flex min-w-0 flex-wrap items-center gap-1">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleFileSelect}
            disabled={uploading}
          />
          <Button type="button" variant="ghost" size="icon-sm" className="composer-attach" aria-label="添加附件" title="添加附件（也可从 Finder 拖入）"
            disabled={!commandById('upload')?.available(commandContext).available}
            onClick={() => commandById('upload')?.run(commandContext)}>
            <Paperclip className="size-4"/>
          </Button>
          {usagePreferences && usagePreferences.voice !== 'off' && <VoiceInput key={scope} sessionId={sessionId} disabled={blocked} engine={usagePreferences.voice ?? null} onBusyChange={setVoiceBusy}
            focusDraft={() => {setSlash(null); textareaRef.current?.focus({preventScroll: true})}}
            fill={text => {
              if (scopeRef.current !== scope) return
              const field = textareaRef.current
              const current = field?.value ?? inputValue
              const cursor = field?.selectionStart ?? current.length
              const next = current.slice(0, cursor) + text + current.slice(cursor)
              pendingCursor.current = cursor + text.length
              setInputValue(next)
              onInputValueChange?.(next)
              setSlash(null)
              flashHighlight(field)
            }}/>}
          <div className="composer-shortcuts flex items-center gap-1">
            <Button type="button" variant="ghost" size="icon-sm" aria-label="命令、场景与 Skill" title="命令 / · 场景与 Skill @"
              data-slash-toggle aria-expanded={slashOpen} disabled={blocked} onClick={() => {
                if (slashOpen) {dismissedRef.current = slash; setSlash(null); return}
                const node = textareaRef.current
                if (!node) return
                const cursor = node.selectionStart ?? inputValue.length
                node.focus()
                setActiveId(null)
                setSlash(findSlashTrigger(inputValue, cursor, false) ?? {trigger: '/', start: cursor, end: cursor, query: ''})
              }}><Sparkles/></Button>
            <Button type="button" variant="ghost" size="icon-sm" aria-label="计划模式" title="计划模式"
              aria-pressed={planMode} className="aria-pressed:bg-signal-soft aria-pressed:text-signal"
              disabled={blocked || !commandById('plan')?.available(commandContext).available}
              onClick={() => commandById('plan')?.run(commandContext)}><ListChecks/></Button>
          </div>
        </div>
        {/* 发送/停止生成按钮 */}
        <div className="composer-submit-actions flex min-w-0 items-center gap-1">
          <ModelPicker
            sessionId={sessionId}
            savedModel={savedModel}
            savedReasoning={savedReasoning}
            runModel={runModel}
            runReasoning={runReasoning}
            contextTokens={contextTokens}
            onModelCommitted={onModelCommitted}
            onSelection={setModelChoice}
          />
          {typeof accessory === 'function' ? accessory(commandContext) : accessory}
          <Button
            type="button"
            variant={showPause ? 'secondary' : 'default'}
            className="size-[34px] shrink-0 cursor-pointer rounded-[11px] transition-transform active:scale-90 motion-reduce:transition-none"
            onClick={showPause ? onPause : handleSend}
            disabled={showPause ? pause === 'stopping' || !onPause : blocked || voiceBusy || uploading || hasMissingFiles || !inputValue.trim()}
            aria-label={showPause ? (pause === 'stopping' ? '正在停止' : '停止生成') : '发送'}
            title={showPause ? (pause === 'stopping' ? '正在停止' : '停止生成') : '发送'}
          >
            {showPause ? (
              <Stop className="size-3.5 fill-current"/>
            ) : sending ? (
              <Loader2 className="size-4 animate-spin"/>
            ) : (
              <ArrowUp/>
            )}
          </Button>
        </div>
      </footer>
      <FilePreviewDialog file={preview} onClose={() => setPreview(null)} onDownload={file => void downloadFile(file.id, file.filename).catch(error => toast.error(error instanceof Error ? error.message : '下载失败'))}/>
    </div>
    <PopoverContent
      align="start"
      side={sessionId ? "top" : "bottom"}
      sideOffset={8}
      collisionBoundary={textareaRef.current?.closest('.task-paper') ?? undefined}
      collisionPadding={8}
      className="w-[min(var(--radix-popover-trigger-width),calc(100vw-2rem))] max-h-(--radix-popover-content-available-height) overflow-hidden rounded-2xl p-0"
      onOpenAutoFocus={(event) => event.preventDefault()}
      onCloseAutoFocus={(event) => event.preventDefault()}
      onInteractOutside={event => {if (event.target instanceof Element && event.target.closest('[data-slash-toggle]')) event.preventDefault()}}
    >
      {slashOpen && slash && (
        <SlashCommandList
          id={slashListId}
          trigger={slash.trigger}
          query={slash.query}
          presetCommands={presetCommands}
          extraCommands={skillCommands}
          context={commandContext}
          activeId={resolvedActiveId}
          onActiveIdChange={setActiveId}
          keyboardStep={keyboardStep}
          onRun={runSlash}
        />
      )}
    </PopoverContent>
    </Popover>
    )
  }
)

function sameFragment(prev: SlashFragment | null, next: SlashFragment | null): boolean {
  if (prev === next) return true
  if (!prev || !next) return false
  return prev.trigger === next.trigger && prev.start === next.start && prev.end === next.end && prev.query === next.query
}

ChatInput.displayName = 'ChatInput'
