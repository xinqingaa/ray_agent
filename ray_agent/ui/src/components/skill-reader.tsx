'use client'
import {useState, type ReactNode} from 'react'
import {FileCode2, FileText, Files} from 'lucide-react'
import {MarkdownContent} from '@/components/markdown-content'
import {Button} from '@/components/ui/button'
import {cn, formatFileSize} from '@/lib/utils'
import type {SkillDetail} from '@/lib/api/skills'

/** Markdown 是默认阅读面；资源清单是独立、可随时返回的视图。 */
export function SkillReader({skill, actions, feedback, className}: {skill: Pick<SkillDetail, 'text' | 'files' | 'warnings'>; actions?: ReactNode; feedback?: ReactNode; className?: string}) {
  const [view, setView] = useState<'read' | 'files'>('read')
  const body = skill.text.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '')
  return <div className={cn('flex min-h-0 flex-1 flex-col', className)}>
    <div className="flex shrink-0 items-center gap-1 px-6 pb-3"><Button size="sm" variant={view === 'read' ? 'secondary' : 'ghost'} aria-pressed={view === 'read'} onClick={() => setView('read')}><FileText/>说明</Button><Button size="sm" variant={view === 'files' ? 'secondary' : 'ghost'} aria-pressed={view === 'files'} onClick={() => setView('files')}><Files/>文件<span className="text-xs tabular-nums text-faint">{skill.files.length}</span></Button><span className="ml-auto">{actions}</span></div>
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pb-6">
      <div className="mb-3 empty:hidden">{feedback}{skill.warnings.map(w => <p key={w} className="mt-2 rounded-md bg-state-waiting-soft px-3 py-2 text-xs leading-relaxed text-state-waiting">{w}</p>)}</div>
      <div key={view} className="animate-in fade-in duration-150 motion-reduce:animate-none">{view === 'read' ? <MarkdownContent content={body} className="[&_img]:max-w-full"/> : <ul aria-label="Skill 文件清单" className="space-y-1">{skill.files.map(file => <li key={file.path} className="flex min-w-0 items-center gap-3 rounded-md bg-muted/35 px-3 py-2.5 text-xs"><FileCode2 className="size-4 shrink-0 text-faint"/>{file.path === 'SKILL.md' ? <button className="min-w-0 flex-1 break-all text-left font-mono text-signal underline-offset-2 hover:underline" onClick={() => setView('read')}>{file.path}</button> : <span className="min-w-0 flex-1 break-all font-mono">{file.path}</span>}<span className="shrink-0 tabular-nums text-faint">{formatFileSize(file.size)}</span></li>)}</ul>}</div>
    </div>
  </div>
}
