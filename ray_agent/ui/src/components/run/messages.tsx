import {useEffect, useRef, useState} from 'react'
import {Check, Copy, CornerDownRight, Download} from '@/components/ui/icons'
import {MarkdownContent} from '@/components/markdown-content'
import {SkillMark} from '@/components/skill-mark'
import {copyText} from '@/lib/clipboard'
import {cn} from '@/lib/utils'
import type {FileView, RunSummary} from '@/lib/session-view'
import {FileRow, fileMenuEntries} from '@/components/preview/file-row'
import {PreviewAction} from '@/components/preview/action'
import {formatFullDateTime, formatMessageTime} from './format'

type UserMessageProps = {
  text: string
  at?: number
  /** 显式选择的 skill 名称，与输入框共用整段标记 */
  skillName?: string
  workspaceId?: string
  skillVersion?: string
  runId?: string
  attachments?: FileView[]
  /** 运行中发送、作为补充要求注入当前运行 */
  injected?: boolean
  className?: string
  onPreview?: (file: FileView) => void
  onDownload?: (file: FileView) => void
}

export function CopyIconButton({text, label, className}: {text: string; label: string; className?: string}) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | null>(null)
  useEffect(() => () => {if (timer.current != null) window.clearTimeout(timer.current)}, [])
  const handleCopy = () => {
    void copyText(text).then(() => {
      setCopied(true)
      if (timer.current != null) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setCopied(false), 1500)
    }).catch(() => {})
  }
  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={copied ? '已复制' : label}
      title={copied ? '已复制' : label}
      className={cn(
        'inline-flex size-6 items-center justify-center rounded-md text-faint outline-none transition-colors hover:bg-muted/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
        copied && 'text-state-success hover:text-state-success',
        className,
      )}
    >
      {copied ? <Check className="size-3.5" aria-hidden/> : <Copy className="size-3.5" aria-hidden/>}
    </button>
  )
}

export function UserMessage({text, at, skillName, skillVersion, runId, workspaceId, attachments = [], injected = false, className, onPreview, onDownload}: UserMessageProps) {
  const timeText = formatMessageTime(at)
  const fullTime = formatFullDateTime(at)
  return (
    <div className={cn('group/msg mt-2 mb-3 flex min-w-0 flex-col items-end gap-1.5', className)}>
      {injected && (
        <span className="inline-flex items-center gap-1 text-xs text-signal">
          <CornerDownRight className="size-3" aria-hidden/>
          补充要求，已加入当前运行
        </span>
      )}
      {(text || skillName) && <div
        className={cn(
          'max-w-[min(36rem,86%)] rounded-[16px_16px_6px_16px] px-3.5 py-2.5',
          injected ? 'border border-dashed border-signal/50 bg-signal-soft/40' : 'bg-secondary',
        )}
      >
        <div className="whitespace-pre-wrap wrap-anywhere text-sm leading-relaxed">{skillName && <SkillMark name={skillName} version={skillVersion} runId={runId} workspaceId={workspaceId} className="mr-1.5"/>}{text}</div>
      </div>}
      {attachments.length > 0 && <div className="flex max-w-full flex-wrap justify-end gap-1.5">
        {attachments.map(file => <FileRow key={file.id} file={file} compact showThumbnail
          menu={fileMenuEntries(file, {onPreview, onDownload})}
          onOpen={onPreview ? () => onPreview(file) : undefined}
          actions={onDownload && <PreviewAction label={`下载 ${file.filename}`} icon={Download} onClick={() => onDownload(file)}/>}/>)}
      </div>}
      {(timeText || text) && (
        <div className="flex h-6 items-center gap-1 opacity-0 transition-opacity duration-(--motion-fast) group-hover/msg:opacity-100 group-focus-within/msg:opacity-100 [@media(hover:none)]:opacity-100 motion-reduce:transition-none">
          {timeText && (
            <time className="text-xs text-faint tabular-nums" dateTime={at ? new Date(at).toISOString() : undefined} title={fullTime}>
              {timeText}
            </time>
          )}
          {text && <CopyIconButton text={text} label="复制消息"/>}
        </div>
      )}
    </div>
  )
}

type StreamingProps = {
  /** W6 增量渲染入口：为 true 时文本仍在增长，末尾显示输入光标 */
  streaming?: boolean
  deliveredFiles?: FileView[]
  onDownloadFile?: (file: FileView) => void
}

/** 增量生成时在最后一个块的末尾显示静态光标（不闪烁，动画只留给状态条） */
const STREAMING_CARET = "[&_.markdown-content>:last-child]:after:ml-0.5 [&_.markdown-content>:last-child]:after:text-foreground/60 [&_.markdown-content>:last-child]:after:content-['▍']"

/** 旁白：伴随工具调用的助手文本，比最终回复弱一级 */
export function NarrationBlock({text, streaming, className, deliveredFiles, onDownloadFile}: {text: string; className?: string} & StreamingProps) {
  return (
    <div
      className={cn('text-muted-foreground [&_p]:text-meta [&_li]:text-meta', streaming && STREAMING_CARET, className)}
      aria-busy={streaming || undefined}
    >
      <MarkdownContent content={text} deliveredFiles={deliveredFiles} onDownloadFile={onDownloadFile}/>
    </div>
  )
}

type FinalReplyProps = {
  text: string
  summary?: RunSummary | null
  className?: string
  renderCitation?: import('@/components/markdown-content').MarkdownContentProps['renderCitation']
} & StreamingProps

/** 最终回复正文；时间线将本次运行统计附在回复下方。 */
export function FinalReply({text, streaming, className, deliveredFiles, onDownloadFile, renderCitation}: FinalReplyProps) {
  return (
    <article className={cn('min-w-0 space-y-3', className)} aria-busy={streaming || undefined}>
      <div className={cn(streaming && STREAMING_CARET)}>
        <MarkdownContent content={text} deliveredFiles={deliveredFiles} onDownloadFile={onDownloadFile} renderCitation={renderCitation}/>
      </div>
    </article>
  )
}
