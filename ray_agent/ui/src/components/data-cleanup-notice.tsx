'use client'
import {useCallback, useEffect, useRef, useState} from 'react'
import {Button} from '@/components/ui/button'
import {DataCleanupDialog} from './data-cleanup-dialog'
import {dataApi, type CleanupTask} from '@/lib/api/data'
import {notifyDataCleared} from '@/lib/drafts'

/** 关闭确认弹窗后仍能读回进度；重启后的失败任务保留修复入口。 */
export function DataCleanupNotice() {
  const [task, setTask] = useState<CleanupTask | null>(null), [open, setOpen] = useState(false)
  const seen = useRef<string | null>(null), generation = useRef(0)
  const read = useCallback(async () => {
    const token = ++generation.current
    try {
      const latest = await dataApi.latest()
      if (token !== generation.current) return
      if (latest?.state === 'completed') {
        if (seen.current === latest.id) {seen.current=null; notifyDataCleared(latest)}
        setTask(null)
      } else {seen.current=latest?.id || null; setTask(latest)}
    } catch {/* 弹窗内提供显式读取错误；不丢弃已知任务。 */}
  }, [])
  useEffect(() => {
    let alive = true
    const counter = generation
    const refresh = () => {if (alive && document.visibilityState !== 'hidden') void read()}
    refresh()
    const timer = window.setInterval(refresh, task?.state === 'running' ? 2000 : 30000)
    window.addEventListener('focus', refresh); window.addEventListener('rayagent-cleanup-started', refresh)
    return () => {alive=false; counter.current++; window.clearInterval(timer); window.removeEventListener('focus', refresh); window.removeEventListener('rayagent-cleanup-started', refresh)}
  }, [read, task?.state])
  if (!task) return null
  return <><div role="status" className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-state-waiting-soft px-5 py-2 text-sm"><span className="min-w-0 flex-1">{task.name}：{task.state === 'failed' ? '数据清理未完成，需重试' : '正在清理数据'}</span><Button variant="ghost" size="sm" onClick={() => setOpen(true)}>查看清理任务</Button></div><DataCleanupDialog open={open} projectId={task.project_id || undefined} onClose={() => {setOpen(false); void read()}} onCompleted={() => {setOpen(false); void read()}}/></>
}
