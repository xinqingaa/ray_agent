'use client'
import {useCallback, useEffect, useRef, useState, type ReactNode} from 'react'
import {Code2, Copy, Download, FileCode2, FileText, Files, Loader2, RefreshCw} from 'lucide-react'
import {MarkdownContent} from '@/components/markdown-content'
import {Button} from '@/components/ui/button'
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip'
import {cn, formatFileSize} from '@/lib/utils'
import {skillsApi, type SkillDetail} from '@/lib/api/skills'

export function resolveSkillPath(current: string, href: string): string | null {
  if (!href || /^(?:[a-z][a-z\d+.-]*:|\/|\\)/i.test(href)) return null
  try {
    const path = decodeURIComponent(href.split(/[?#]/)[0])
    if (path.includes('\\')) return null
    const parts = current.split('/').slice(0, -1)
    for (const part of path.split('/')) {
      if (!part || part === '.') continue
      if (part === '..') {if (!parts.length) return null; parts.pop()} else parts.push(part)
    }
    return parts.join('/')
  } catch {return null}
}

function imageType(bytes: Uint8Array) {
  if (bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71) return 'image/png'
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg'
  const head = new TextDecoder().decode(bytes.slice(0, 12))
  if (head.startsWith('GIF87a') || head.startsWith('GIF89a')) return 'image/gif'
  if (head.startsWith('RIFF') && head.slice(8) === 'WEBP') return 'image/webp'
  return null
}
function PackageImage({path, read}: {path: string; read: (path: string) => Promise<Blob>}) {
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true, objectUrl = ''
    read(path).then(async blob => {
      const type = imageType(new Uint8Array(await blob.arrayBuffer()))
      if (!type) throw Error('此图片格式不支持显示')
      if (!active) return
      objectUrl = URL.createObjectURL(new Blob([blob], {type}))
      if (active) setUrl(objectUrl)
    }).catch(e => {if (active) setError(e.message)})
    return () => {active = false; if (objectUrl) URL.revokeObjectURL(objectUrl)}
  }, [path, read])
  // eslint-disable-next-line @next/next/no-img-element
  return error ? <span className="text-xs text-muted-foreground">{path}：{error}</span> : url ? <img src={url} alt={path} className="max-h-full max-w-full object-contain"/> : <span role="status">正在读取图片</span>
}

/** 安装前与安装后共用目录、正文及按需资源读取。 */
export function SkillReader({skill, readFile, actions, feedback, className}: {skill: Pick<SkillDetail, 'text' | 'files' | 'warnings'> & Partial<SkillDetail>; readFile?: (path: string) => Promise<Blob>; actions?: ReactNode; feedback?: ReactNode; className?: string}) {
  const panel = useRef<HTMLDivElement>(null)
  const [path, setPath] = useState('SKILL.md')
  const [source, setSource] = useState(false)
  const [directory, setDirectory] = useState(false)
  const [content, setContent] = useState<{path: string; text: string | null; image: boolean} | null>(null)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const read = useCallback((file: string) => {
    if (readFile) return readFile(file)
    if (skill.name && skill.version) return skillsApi.file(skill as SkillDetail, file)
    return Promise.reject(Error('文件读取不可用'))
  }, [readFile, skill])
  useEffect(() => {
    if (path === 'SKILL.md') return
    let active = true
    read(path).then(async blob => {
      const bytes = new Uint8Array(await blob.arrayBuffer())
      let text: string | null = null
      if (!bytes.includes(0)) {try {text = new TextDecoder('utf-8', {fatal: true}).decode(bytes)} catch { /* 保留下载入口 */ }}
      if (active) setContent({path, text, image: !!imageType(bytes)})
    }).catch(e => {if (active) setError(e.message)})
    return () => {active = false}
  }, [path, read, retry])
  const open = (next: string) => {setPath(next); setError(''); setDirectory(false); setContent(null); setSource(false)}
  const current = path === 'SKILL.md' ? {text: skill.text, image: false} : content?.path === path ? content : null
  const markdown = /\.md$/i.test(path)
  const body = current?.text?.replace(path === 'SKILL.md' ? /^\uFEFF?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/ : /$^/, '') ?? ''
  const download = async () => {
    try {
      const blob = await read(path), url = URL.createObjectURL(blob), a = document.createElement('a')
      a.href = url; a.download = path.split('/').pop() || path; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (e) {setError(e instanceof Error ? e.message : '下载失败')}
  }
  return <div className={cn('flex min-h-0 flex-1 flex-col', className)}>
    <div className="flex min-h-0 flex-1">
      <nav aria-label="Skill 文件清单" className={cn('w-full shrink-0 overflow-y-auto border-r px-2 py-2 sm:block sm:w-60', !directory && 'hidden')}>
        {skill.files.map(file => <div key={file.path} className={cn('mb-1 flex min-w-0 items-center gap-1 rounded-md pr-1', path === file.path && 'bg-muted')}>
          <button type="button" aria-current={path === file.path ? 'page' : undefined} onClick={() => open(file.path)} className={cn('flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-2.5 text-left text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', path === file.path && 'text-signal')}><FileCode2 className="size-3.5 shrink-0"/><span className="min-w-0 truncate leading-relaxed" title={file.path}>{file.path}</span></button>
          {path === file.path && <div role="group" aria-label={`${path} 文件操作`} className="flex shrink-0 items-center gap-0.5 text-muted-foreground [&_button]:size-6 [&_svg]:size-3.5">
            {markdown && <FileAction label={source ? '查看正文' : '查看源码'} pressed={source} onClick={() => {setSource(!source); setDirectory(false)}}>{source ? <FileText/> : <Code2/>}</FileAction>}
            {current?.text != null && <FileAction label="复制文件内容" onClick={() => {void navigator.clipboard.writeText(current.text!).catch(() => setError('复制失败，请重试'))}}><Copy/></FileAction>}
            <FileAction label="下载文件" onClick={download}><Download/></FileAction>{path === 'SKILL.md' && actions}
          </div>}
        </div>)}
      </nav>
      <div className={cn('flex min-w-0 flex-1 flex-col', directory && 'hidden sm:flex')}>
        <Button size="sm" variant="ghost" className="ml-3 mt-1 self-start sm:hidden" aria-label="文件目录" onClick={() => setDirectory(true)}><Files/>文件</Button>
        <div ref={panel} className="min-h-0 flex-1 overflow-auto overscroll-contain px-5 py-4">
          {feedback}{skill.warnings.map(w => <p key={w} className="mb-3 text-xs text-state-waiting">{w}</p>)}
          {error ? <div role="alert" className="text-sm text-state-failed">{error}<Button size="sm" variant="ghost" onClick={() => {setError(''); setRetry(x => x + 1)}}><RefreshCw/>重试</Button></div> : !current ? <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin"/>正在读取文件</div> : current.image ? <PackageImage key={path} path={path} read={read}/> : current.text == null ? <p className="text-sm text-muted-foreground">此文件无法显示为文本，可下载查看。{formatFileSize(skill.files.find(f => f.path === path)?.size ?? 0)}</p> : markdown && !source ? <MarkdownContent content={body} components={{
            a: ({href, children}) => {
              if (href?.startsWith('#')) return <a href={href} className="text-signal" onClick={event => {
                event.preventDefault()
                const slug = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-')
                let anchor: string
                try {anchor = decodeURIComponent(href.slice(1))} catch {return}
                Array.from(panel.current?.querySelectorAll('h1,h2,h3,h4,h5,h6') ?? []).find(node => node.id === anchor || slug(node.textContent ?? '') === anchor)?.scrollIntoView({block: 'start'})
              }}>{children}</a>
              if (/^https?:\/\//i.test(href ?? '')) return <a href={href} target="_blank" rel="noopener noreferrer" className="text-signal hover:underline">{children}</a>
              const next = resolveSkillPath(path, href ?? '')
              return <button type="button" className="text-signal hover:underline" onClick={() => next && skill.files.some(f => f.path === next) ? open(next) : setError('链接指向的文件不在此 Skill 中')}>{children}</button>
            },
            img: ({src}) => {const next = typeof src === 'string' ? resolveSkillPath(path, src) : null; return next && skill.files.some(f => f.path === next) ? <PackageImage path={next} read={read}/> : <span className="text-xs text-muted-foreground">图片不在此 Skill 中</span>},
          }}/> : <div className="font-mono text-xs leading-relaxed">{current.text.split('\n').map((line, i) => <div key={i} className="flex"><span aria-hidden className="mr-4 w-8 shrink-0 select-none text-right text-faint">{i + 1}</span><pre className="whitespace-pre-wrap break-all">{line || ' '}</pre></div>)}</div>}
        </div>
      </div>
    </div>
    {directory && <Button className="sm:hidden" variant="ghost" onClick={() => setDirectory(false)}>返回正文</Button>}
  </div>
}

function FileAction({label, pressed, onClick, children}: {label: string; pressed?: boolean; onClick: () => void; children: ReactNode}) {
  return <Tooltip><TooltipTrigger asChild><Button size="icon-xs" variant="ghost" aria-label={label} aria-pressed={pressed} onClick={onClick}>{children}</Button></TooltipTrigger><TooltipContent sideOffset={6}>{label}</TooltipContent></Tooltip>
}
