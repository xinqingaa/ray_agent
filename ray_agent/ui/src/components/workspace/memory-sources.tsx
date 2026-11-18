import {useEffect, useState} from 'react'
import {Button} from '@/components/ui/button'
import {Link} from '@/lib/navigation'
import {memoryApi} from '@/lib/api/memory'
import type {MemorySourcesResponse} from '@/lib/api/types'
import {workspaceSessionHref} from '@/lib/workspace-route'

export function MemorySources({workspaceId, memoryId, memoryVersion}: {workspaceId: string; memoryId: string; memoryVersion?: number}) {
  const [data, setData] = useState<MemorySourcesResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    let cancelled = false
    void memoryApi.sources(workspaceId, memoryId).then(result => {if (!cancelled) setData(result)})
      .catch(reason => {if (!cancelled) setError(reason instanceof Error ? reason.message : '读取来源失败')})
    return () => {cancelled = true}
  }, [workspaceId, memoryId, retry])

  if (error) return <p role="alert" className="text-xs text-state-failed">{error}
    <Button variant="ghost" size="xs" onClick={() => {setError(null); setRetry(value => value + 1)}}>重试</Button></p>
  if (!data) return <p role="status" className="text-xs text-muted-foreground">正在读取来源…</p>
  const sources = memoryVersion == null ? data.sources : data.sources.filter(source => source.memory_version === memoryVersion)
  if (!sources.length) return <p className="text-xs text-muted-foreground">{memoryVersion == null ? '没有记录来源。' : `v${memoryVersion} 没有可对应的来源记录。`}</p>

  return <ul className="space-y-1 text-xs text-muted-foreground">
    {sources.map(source => {
      const version = source.memory_version != null ? `记忆 v${source.memory_version}` : '记忆版本未知'
      const sequence = source.event_seq_end != null ? ` · 事件 #${source.event_seq_end}` : ''
      return <li key={source.id} className="flex flex-wrap items-center gap-2">
        <span>{version}</span>
        {source.available && source.session_id
          ? <Link className="rounded text-signal underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring"
              href={`${workspaceSessionHref(workspaceId, source.session_id)}${source.event_seq_end != null ? `#event-${source.event_seq_end}` : ''}`}>来源对话{sequence}</Link>
          : source.document_id ? <span>{source.available ? '文件来源' : '文件来源已不可读'}{source.document_revision != null ? ` · 版本 ${source.document_revision}` : ''}</span>
          : <span>{source.available ? '工作区记录' : '来源已不可读'}</span>}
      </li>
    })}
  </ul>
}
