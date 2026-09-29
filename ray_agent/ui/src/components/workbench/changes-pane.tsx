'use client'

import {useCallback, useEffect, useState} from 'react'
import {Loader2, RefreshCw} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {ScrollArea} from '@/components/ui/scroll-area'
import {projectApi} from '@/lib/api/project'
import type {GitDiff, GitStatus, GitStatusEntry} from '@/lib/api/types'
import {cn} from '@/lib/utils'
import {toast} from 'sonner'

function EmptyNote({children}: {children: string}) {
  return <p className="px-4 py-8 text-center text-meta text-faint">{children}</p>
}

function entryLabel(entry: GitStatusEntry): string {
  if (entry.kind === 'untracked') return '未跟踪'
  const parts: string[] = []
  if (entry.index) parts.push(`暂存 ${entry.index}`)
  if (entry.worktree) parts.push(`工作区 ${entry.worktree}`)
  return parts.join(' · ') || entry.xy
}

type ChangesPaneProps = {
  sessionId: string
  refreshSignal?: number
  onBranchUpdate?: (branch: string | null) => void
}

export function ChangesPane({sessionId, refreshSignal, onBranchUpdate}: ChangesPaneProps) {
  const [status, setStatus] = useState<GitStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [diff, setDiff] = useState<GitDiff | null>(null)
  const [diffLoading, setDiffLoading] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const next = await projectApi.getGitStatus(sessionId)
      setStatus(next)
      onBranchUpdate?.(next.state === 'ok' ? next.branch ?? null : null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '读取 Git 状态失败')
    } finally {
      setLoading(false)
    }
  }, [sessionId, onBranchUpdate])

  useEffect(() => {
    void refresh()
  }, [refresh, refreshSignal])

  const loadDiff = async (entry: GitStatusEntry) => {
    setSelectedPath(entry.path)
    setDiffLoading(true)
    setDiff(null)
    const scope = entry.index && !entry.worktree ? 'staged' : 'worktree'
    try {
      const result = await projectApi.getGitDiff(sessionId, scope, entry.path)
      setDiff(result)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '读取 diff 失败')
    } finally {
      setDiffLoading(false)
    }
  }

  if (loading && !status) {
    return <EmptyNote>正在读取 Git 状态</EmptyNote>
  }

  if (status?.state === 'not_a_repository') {
    return <EmptyNote>这个项目不是 Git 仓库</EmptyNote>
  }

  if (status && status.state !== 'ok') {
    return (
      <EmptyNote>
        {status.error ?? (status.state === 'timeout' ? '读取 Git 状态超时' : '读取 Git 状态失败')}
      </EmptyNote>
    )
  }

  const entries = status?.entries ?? []

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {status?.branch ? `分支 ${status.branch}` : '无分支信息'}
          {status?.ahead != null && status.behind != null && (status.ahead > 0 || status.behind > 0) && (
            <span className="ml-2 tabular-nums">↑{status.ahead} ↓{status.behind}</span>
          )}
        </span>
        <Button type="button" variant="ghost" size="icon-xs" aria-label="刷新" onClick={() => void refresh()} disabled={loading}>
          {loading ? <Loader2 className="size-4 animate-spin"/> : <RefreshCw className="size-4"/>}
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <ScrollArea className="min-h-0 max-h-[40%] shrink-0 border-b md:max-h-none md:w-[42%] md:border-b-0 md:border-r">
          {entries.length === 0 ? (
            <p className="px-3 py-6 text-center text-meta text-faint">工作区干净，没有改动</p>
          ) : (
            <ul className="p-1">
              {entries.map((entry) => (
                <li key={`${entry.path}:${entry.xy}`}>
                  <button
                    type="button"
                    onClick={() => void loadDiff(entry)}
                    className={cn(
                      'flex w-full flex-col items-start rounded-md px-2 py-1.5 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring',
                      selectedPath === entry.path && 'bg-muted',
                    )}
                  >
                    <span className="truncate font-mono text-xs">{entry.path}</span>
                    <span className="text-[11px] text-muted-foreground">{entryLabel(entry)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {status?.truncated && (
            <p className="px-3 py-2 text-xs text-muted-foreground">改动过多，列表已截断。</p>
          )}
        </ScrollArea>
        <ScrollArea className="min-h-0 flex-1">
          <div className="p-3">
            {!selectedPath && <p className="text-meta text-faint">选中一项查看 diff。</p>}
            {selectedPath && diffLoading && (
              <p className="text-meta text-muted-foreground"><Loader2 className="mr-1 inline size-4 animate-spin"/>正在读取 diff</p>
            )}
            {diff && diff.diff && (
              <pre className="overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-xs leading-5 whitespace-pre-wrap break-all">
                {diff.diff.length > 50000 ? `${diff.diff.slice(0, 50000)}…` : diff.diff}
              </pre>
            )}
            {diff && !diff.diff && diff.state === 'ok' && (
              <p className="text-meta text-faint">{diff.untracked ? '未跟踪文件，全部为新增内容。' : '没有可显示的 diff 文本。'}</p>
            )}
            {diff && diff.truncated && (
              <p className="mt-2 text-xs text-muted-foreground">diff 过长，输出已截断。</p>
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}
