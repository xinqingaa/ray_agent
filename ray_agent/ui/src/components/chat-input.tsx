'use client'

import {useState, useRef, useMemo, useCallback, useId, useLayoutEffect, forwardRef, useImperativeHandle, type ReactNode} from 'react'
import {cn, formatFileSize} from '@/lib/utils'
import {ScrollArea, ScrollBar} from '@/components/ui/scroll-area'
import {Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle} from '@/components/ui/item'
import {Avatar, AvatarGroupCount} from '@/components/ui/avatar'
import {ArrowUp, FileText, XCircle, Loader2} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {Popover, PopoverAnchor, PopoverContent} from '@/components/ui/popover'
import {PlusCommandMenu, SlashCommandList} from '@/components/input-command-menu'
import {fileApi} from '@/lib/api/file'
import type {FileInfo} from '@/lib/api/types'
import {toast} from 'sonner'
import {matchingCommands, type CommandContext, type CommandHost, type InputCommand} from '@/lib/commands'
import {findSlashTrigger, removeSlashFragment, type SlashFragment} from '@/lib/slash-trigger'

interface ChatInputProps {
  className?: string
  onInputValueChange?: (value: string) => void
  onSend?: (message: string, files: FileInfo[]) => Promise<void>
  disabled?: boolean
  /** 当前会话 ID，上传附件时会关联到该会话 */
  sessionId?: string | null
  placeholder?: string
  /** 发送按钮左侧，例如上下文环 */
  accessory?: ReactNode
  /** 页面状态。上传中与文件选择由输入框补进命令上下文。 */
  commandHost?: CommandHost
}

const EMPTY_HOST: CommandHost = {
  hasSession: false,
  runStatus: 'idle',
  waitingApproval: false,
  waitingReply: false,
  submitting: false,
}

export interface ChatInputRef {
  setInputText: (text: string) => void
  getInputValue: () => string
  getFiles: () => FileInfo[]
}

export const ChatInput = forwardRef<ChatInputRef, ChatInputProps>(
  ({ className, onInputValueChange, onSend, disabled = false, sessionId, placeholder = '分配一个任务或提问任何问题...', accessory, commandHost = EMPTY_HOST }, ref) => {
    const [files, setFiles] = useState<FileInfo[]>([])
    const [uploading, setUploading] = useState(false)
    const [sending, setSending] = useState(false)
    const [inputValue, setInputValue] = useState('')
    const [slash, setSlash] = useState<SlashFragment | null>(null)
    const [activeId, setActiveId] = useState<string | null>(null)
    const fileInputRef = useRef<HTMLInputElement>(null)
    const textareaRef = useRef<HTMLTextAreaElement>(null)
    const composingRef = useRef(false)
    const pendingCursor = useRef<number | null>(null)
    /** Esc 或执行命令后，同一片段不要被随后的 keyup 重新打开。 */
    const dismissedRef = useRef<SlashFragment | null>(null)
    const slashListId = useId()
    const blocked = disabled || sending
    const [wasBlocked, setWasBlocked] = useState(blocked)
    if (blocked !== wasBlocked) {
      setWasBlocked(blocked)
      if (blocked) setSlash(null)
    }

    const openFilePicker = useCallback(() => {
      fileInputRef.current?.click()
    }, [])

    const commandContext = useMemo<CommandContext>(() => ({
      hasSession: commandHost.hasSession,
      runStatus: commandHost.runStatus,
      waitingApproval: commandHost.waitingApproval,
      waitingReply: commandHost.waitingReply,
      submitting: commandHost.submitting || sending,
      uploading,
      actions: {openFilePicker},
    }), [
      commandHost.hasSession,
      commandHost.runStatus,
      commandHost.waitingApproval,
      commandHost.waitingReply,
      commandHost.submitting,
      sending,
      uploading,
      openFilePicker,
    ])

    const slashOpen = slash != null && !blocked
    const matched = useMemo(
      () => (slashOpen && slash ? matchingCommands(slash.query) : []),
      [slashOpen, slash],
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
        const uploadPromises = Array.from(selectedFiles).map(async (file) => {
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

        if (uploadedFiles.length > 0) {
          setFiles((prev) => [...prev, ...uploadedFiles])
          toast.success(`成功上传 ${uploadedFiles.length} 个文件`)
        }
      } catch {
        toast.error('文件上传过程中发生错误')
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
          await onSend(trimmedMessage, files)
          // 发送成功后清空输入框和文件列表
          setInputValue('')
          setFiles([])
          setSlash(null)
          onInputValueChange?.('')
        } catch (error) {
          // 错误处理由 onSend 内部处理
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

    return (
    <Popover open={slashOpen} onOpenChange={(open) => { if (!open) setSlash(null) }}>
    <div className={cn('flex flex-col bg-card w-full rounded-2xl py-3 border', className)}>
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
                      disabled={uploading}
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
          disabled={sending || disabled}
        />
      </div>
      </PopoverAnchor>
      {/* 底部上传&发送按钮 */}
      <footer className="flex flex-row items-center justify-between w-full px-3">
        {/* 命令菜单 */}
        <div className="flex gap-2">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleFileSelect}
            disabled={uploading}
          />
          <PlusCommandMenu context={commandContext}/>
        </div>
        {/* 发送/暂停按钮 */}
        <div className="flex items-center gap-1">
          {accessory}
          <Button
            type="button"
            variant="outline"
            className="rounded-full w-8 h-8 cursor-pointer"
            onClick={handleSend}
            disabled={sending || disabled || !inputValue.trim()}
            aria-label="发送"
          >
            {sending ? (
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
