import { useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown, {defaultUrlTransform} from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import {Check, Copy} from 'lucide-react'
import { cn } from '@/lib/utils'
import type {FileView} from '@/lib/session-view'
import {resolveMessageFileLink} from '@/lib/message-file-links'
import {downloadFile} from '@/lib/api/preview'
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip'
import {toast} from 'sonner'

export interface MarkdownContentProps {
  content: string
  className?: string
  components?: React.ComponentProps<typeof ReactMarkdown>['components']
  deliveredFiles?: readonly FileView[]
  onDownloadFile?: (file: FileView) => void
}

/**
 * remark-gfm autolink 对紧跟 CJK 字符的 URL 边界检测不准确，
 * 会将 `https://example.com，后续中文` 整段识别为链接。
 * 在 URL 与相邻 CJK 字符/标点之间插入空格修正边界。
 */
const CJK_RANGES = '\u3000-\u303F\u4E00-\u9FFF\uFF01-\uFF60'
const URL_FOLLOWED_BY_CJK = new RegExp(
  `(https?:\\/\\/[^\\s${CJK_RANGES}]+)([${CJK_RANGES}])`,
  'g',
)

function normalizeAutolinks(text: string): string {
  return text.replace(URL_FOLLOWED_BY_CJK, '$1 $2')
}

/** 只高亮显式标注语言的代码块；未注册的语言按纯文本显示。 */
const REHYPE_PLUGINS: React.ComponentProps<typeof ReactMarkdown>['rehypePlugins'] = [[rehypeHighlight, {detect: false}]]

/** 字号逐级拉开，h1、h2 另加分隔线；h5、h6 与正文同级，只靠字重和弱色区分。 */
const headingClasses: Record<string, string> = {
  h1: 'text-xl font-semibold tracking-tight mt-7 mb-3 pb-2 border-b first:mt-0',
  h2: 'text-lg font-semibold tracking-tight mt-6 mb-2.5 pb-1.5 border-b border-border/70 first:mt-0',
  h3: 'text-base font-semibold mt-5 mb-2 first:mt-0',
  h4: 'text-sm font-semibold mt-4 mb-1.5 first:mt-0',
  h5: 'text-sm font-medium mt-3 mb-1 first:mt-0 text-muted-foreground',
  h6: 'text-xs font-medium mt-3 mb-1 first:mt-0 text-muted-foreground',
}

type HastNode = {type: string; value?: string; properties?: {className?: unknown}; children?: HastNode[]}

function hastText(node: HastNode | undefined): string {
  if (!node) return ''
  if (node.type === 'text') return node.value ?? ''
  return (node.children ?? []).map(hastText).join('')
}

function CopyCodeButton({text, className}: {text: string; className?: string}) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | null>(null)
  useEffect(() => () => {if (timer.current) window.clearTimeout(timer.current)}, [])
  const label = copied ? '已复制' : '复制代码'
  return <Tooltip><TooltipTrigger asChild>
    <button type="button" aria-label={label} onClick={() => {
      void navigator.clipboard.writeText(text).then(() => {
        setCopied(true)
        if (timer.current) window.clearTimeout(timer.current)
        timer.current = window.setTimeout(() => setCopied(false), 1500)
      }).catch(() => toast.error('复制失败，请重试'))
    }} className={cn('inline-flex size-6 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-foreground/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring', className)}>
      {copied ? <Check className="size-3.5 text-state-success" aria-hidden/> : <Copy className="size-3.5" aria-hidden/>}
    </button>
  </TooltipTrigger><TooltipContent>{label}</TooltipContent></Tooltip>
}

function CodeBlock({node, className, children, ...props}: React.ComponentProps<'pre'> & {node?: unknown}) {
  const code = (node as HastNode | undefined)?.children?.find(child => child.type === 'element')
  const classes = Array.isArray(code?.properties?.className) ? code.properties.className as unknown[] : []
  const language = classes.find((name): name is string => typeof name === 'string' && name.startsWith('language-'))?.slice('language-'.length)
  const text = hastText(code ?? node as HastNode | undefined).replace(/\n$/, '')
  return (
    <div className="group/code my-3 overflow-hidden rounded-lg border bg-muted/60">
      {language ? (
        <div className="flex h-8 items-center justify-between border-b bg-muted/80 pl-3 pr-1">
          <span className="font-mono text-xs text-muted-foreground">{language}</span>
          <CopyCodeButton text={text}/>
        </div>
      ) : null}
      <div className="relative">
        {!language && <CopyCodeButton text={text} className="absolute right-1 top-1 bg-muted opacity-0 transition-opacity duration-150 group-hover/code:opacity-100 focus-visible:opacity-100 motion-reduce:transition-none"/>}
        <pre className={cn('overflow-x-auto px-3.5 py-3', className)} {...props}>{children}</pre>
      </div>
    </div>
  )
}

function MarkdownLink({node, className, href, children, ...props}: React.ComponentProps<'a'> & {node?: unknown}) {
  // CJK autolink 兜底。已交付文件在调用方先匹配，因此中文文件名不受此限制。
  if (href && /[\u4E00-\u9FFF\u3000-\u303F\uFF00-\uFFEF]/.test(href)) return <span>{children}</span>
  return <a className={cn('text-signal underline decoration-signal/30 underline-offset-[3px] hover:decoration-signal', className)}
    href={href} target="_blank" rel="noopener noreferrer" {...props}>{children}</a>
}

const LIST = 'mb-3 last:mb-0 space-y-1 pl-5 [li>&]:mt-1 [li>&]:mb-0'

const components: React.ComponentProps<typeof ReactMarkdown>['components'] = {
  h1: ({ node, className, ...props }) => (
    <h1 className={cn(headingClasses.h1, className)} {...props} />
  ),
  h2: ({ node, className, ...props }) => (
    <h2 className={cn(headingClasses.h2, className)} {...props} />
  ),
  h3: ({ node, className, ...props }) => (
    <h3 className={cn(headingClasses.h3, className)} {...props} />
  ),
  h4: ({ node, className, ...props }) => (
    <h4 className={cn(headingClasses.h4, className)} {...props} />
  ),
  h5: ({ node, className, ...props }) => (
    <h5 className={cn(headingClasses.h5, className)} {...props} />
  ),
  h6: ({ node, className, ...props }) => (
    <h6 className={cn(headingClasses.h6, className)} {...props} />
  ),
  p: ({ node, className, ...props }) => (
    <p className={cn('mb-3 last:mb-0 [li>&]:mb-1', className)} {...props} />
  ),
  // 嵌套无序列表依次换用空心圆点与方块，层级不靠缩进单独辨认。
  ul: ({ node, className, ...props }) => (
    <ul className={cn(LIST, 'list-disc [ul_&]:list-[circle] [ul_ul_&]:list-[square]',
      className?.includes('contains-task-list') && 'list-none pl-1', className)} {...props} />
  ),
  ol: ({ node, className, ...props }) => (
    <ol className={cn(LIST, 'list-decimal marker:tabular-nums', className)} {...props} />
  ),
  li: ({ node, className, ...props }) => (
    <li className={cn('pl-1 marker:text-muted-foreground', className?.includes('task-list-item') && 'flex items-start gap-2 pl-0 [&>input]:mt-[0.45em] [&>input]:accent-signal', className)} {...props} />
  ),
  strong: ({ node, className, ...props }) => (
    <strong className={cn('font-semibold text-foreground', className)} {...props} />
  ),
  del: ({ node, className, ...props }) => (
    <del className={cn('text-muted-foreground', className)} {...props} />
  ),
  code: ({ node, className, children, ...props }) => {
    const text = typeof children === 'string' ? children : ''
    const isBlock = text.includes('\n') || /language-|hljs/.test(className ?? '')
    return (
      <code
        className={cn(
          isBlock
            ? 'block w-max min-w-full text-meta leading-relaxed font-mono'
            : 'inline rounded-[0.3rem] border border-border/70 bg-muted px-[0.35em] py-px text-[0.85em] font-mono',
          className
        )}
        {...props}
      >
        {children}
      </code>
    )
  },
  pre: CodeBlock,
  table: ({ node, className, ...props }) => (
    <div className="my-3 overflow-x-auto rounded-lg border">
      <table className={cn('w-full border-collapse text-meta tabular-nums', className)} {...props} />
    </div>
  ),
  thead: ({ node, className, ...props }) => (
    <thead className={cn('bg-muted', className)} {...props} />
  ),
  tr: ({ node, className, ...props }) => (
    <tr className={cn('[tbody>&]:even:bg-muted/45 [tbody>&]:hover:bg-signal-soft/50', className)} {...props} />
  ),
  th: ({ node, className, ...props }) => (
    <th className={cn('whitespace-nowrap border-b border-r px-3 py-2 text-left font-semibold text-foreground last:border-r-0', className)} {...props} />
  ),
  td: ({ node, className, ...props }) => (
    <td className={cn('border-b border-r border-border/60 px-3 py-2 align-top last:border-r-0 [tr:last-child>&]:border-b-0', className)} {...props} />
  ),
  hr: ({ node, className, ...props }) => (
    <hr className={cn('my-6 border-border', className)} {...props} />
  ),
  blockquote: ({ node, className, ...props }) => (
    <blockquote
      className={cn(
        'my-3 rounded-r-md border-l-[3px] border-signal/35 bg-muted/50 py-2 pl-4 pr-3 text-muted-foreground [&>p]:mb-1.5 [&>p:last-child]:mb-0',
        className
      )}
      {...props}
    />
  ),
  a: MarkdownLink,
}

export function MarkdownContent({ content, className, deliveredFiles, onDownloadFile, components: overrides }: MarkdownContentProps) {
  const normalized = useMemo(() => normalizeAutolinks(content), [content])

  return (
    <div className={cn('markdown-content break-words text-sm leading-[1.75]', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={REHYPE_PLUGINS}
        urlTransform={(url, key) => key === 'href' && deliveredFiles && resolveMessageFileLink(url, deliveredFiles) !== null ? url : defaultUrlTransform(url)}
        components={{...(deliveredFiles ? {...components, a: ({node, className, href, children, ...props}) => {
          const file = href ? resolveMessageFileLink(href, deliveredFiles) : null
          if (file === 'unavailable') return <span title="此路径没有可用的交付附件">{children}</span>
          if (file) return <button type="button" title={`下载 ${file.filename}`} className={cn('text-signal underline decoration-signal/30 underline-offset-[3px] hover:decoration-signal', className)}
            onClick={() => onDownloadFile ? onDownloadFile(file) : void downloadFile(file.id, file.filename).catch(error => toast.error(error instanceof Error ? error.message : '下载失败'))}>{children}</button>
          return <MarkdownLink node={node} className={className} href={href} {...props}>{children}</MarkdownLink>
        }} : components), ...overrides}}>
        {normalized}
      </ReactMarkdown>
    </div>
  )
}
