'use client'
import Link from 'next/link'
import {Pencil, Plus} from 'lucide-react'
import {IconAction} from '@/components/ui/icon-action'
import {DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger} from '@/components/ui/dropdown-menu'
import {MarkdownContent} from '@/components/markdown-content'
import {cn} from '@/lib/utils'
import type {ProjectMemorySummary, Session} from '@/lib/api/types'

export function ProjectSummaryList({candidates, sessions, onEdit}: {candidates: ProjectMemorySummary[]; sessions: Session[]; onEdit: (item: {id: string; title: string}) => void}) {
  return <div>
              {!candidates.length && <p className="py-6 text-meta text-faint">还没有对话摘要。摘要保留对话要点，供后续任务参考。</p>}
              {candidates.map(item => {
                const status = summaryStatus(item)
                return (
                  <article key={item.session_id} className="group/summary border-b py-3">
                    <div className="flex items-center gap-2">
                      <Link href={`/sessions/${item.session_id}`} className="min-w-0 flex-1 truncate text-sm">{item.title || '项目对话'}</Link>
                      {status && <span className={cn('shrink-0 text-xs', item.state === 'failed' ? 'text-state-failed' : 'text-faint')}>{status}</span>}
                      <IconAction label={`编辑 ${item.title || '项目对话'} 的摘要`} onClick={()=>onEdit({id:item.session_id,title:item.title})}><Pencil/></IconAction>
                    </div>
                    <div className="mt-3"><MarkdownContent content={item.summary}/></div>
                    {item.error && <p className="mt-1 text-xs text-state-failed">{item.error}</p>}
                  </article>
                )
              })}
              {sessions.filter(item => !candidates.some(candidate => candidate.session_id === item.session_id)).length > 0 && <DropdownMenu><DropdownMenuTrigger asChild><IconAction label="添加摘要" className="mt-4"><Plus/></IconAction></DropdownMenuTrigger><DropdownMenuContent align="start" className="max-h-64 max-w-80 overflow-y-auto">{sessions.filter(item => !candidates.some(candidate => candidate.session_id === item.session_id)).map(item => <DropdownMenuItem key={item.session_id} onSelect={() => onEdit({id: item.session_id, title: item.title})}><span className="truncate">{item.title || '项目对话'}</span></DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu>}
  </div>
}

function summaryStatus(item: ProjectMemorySummary) {
  if (item.state === 'failed') return '生成失败'
  if (item.state === 'generating') return '正在生成'
  if (item.stale) return '可能过时'
  return null
}
