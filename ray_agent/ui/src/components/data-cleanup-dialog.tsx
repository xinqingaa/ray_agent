'use client'
import {useCallback, useEffect, useRef, useState} from 'react'
import {useRouter} from 'next/navigation'
import {ArrowUpRight} from 'lucide-react'
import {IconAction} from '@/components/ui/icon-action'
import {Button} from '@/components/ui/button'
import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle} from '@/components/ui/dialog'
import {dataApi, type CleanupPreview, type CleanupTask} from '@/lib/api/data'
import {notifyDataCleared} from '@/lib/drafts'

/** 确认、响应丢失读回与失败重试共用一个入口，重试不重新选择删除对象。 */
export function DataCleanupDialog({open, projectId, onClose, onCompleted, onNavigate}: {open: boolean; projectId?: string; onClose: () => void; onCompleted?: () => void; onNavigate?: () => void | boolean}) {
  const router = useRouter()
  const [preview, setPreview] = useState<CleanupPreview | null>(null)
  const [task, setTask] = useState<CleanupTask | null>(null)
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const generation = useRef(0), completed = useRef(''), baselineTask = useRef<string | null>(null)
  const completedCallback = useRef(onCompleted)
  completedCallback.current = onCompleted
  const complete = useCallback((value: CleanupTask) => {
    if (completed.current === value.id) return
    completed.current = value.id
    notifyDataCleared(value)
    completedCallback.current?.()
  }, [])
  const load = useCallback(async () => {
    const token = generation.current
    try {
      const latest = await dataApi.latest(projectId)
      if (token !== generation.current) return
      baselineTask.current = latest?.id || null
      if (projectId && latest?.state === 'completed') {setTask(latest); complete(latest); return}
      if (latest && latest.state !== 'completed') {setTask(latest); setError(null); return}
      const value = await dataApi.preview(projectId)
      if (token === generation.current) {setPreview(value); setTask(value.task); setError(null)}
    } catch (reason) {if (token === generation.current) setError(reason instanceof Error ? reason.message : '读取失败')}
  }, [projectId, complete])
  useEffect(() => {
    if (!open) return
    generation.current++; setTask(null); setPreview(null); setError(null); setConfirmation(''); setBusy(false)
    void load()
    const counter = generation
    return () => {counter.current++}
  }, [open, load])
  useEffect(() => {
    if (!open || !task || task.state !== 'running') return
    let alive = true
    const read = async () => {
      try {
        const latest = await dataApi.read(task.id)
        if (!alive) return
        setTask(latest); setError(null)
        if (latest.state === 'completed') complete(latest)
      } catch (reason) {if (alive) setError(reason instanceof Error ? reason.message : '状态读取失败，请重试读取')}
    }
    void read()
    const timer = window.setInterval(() => {if (document.visibilityState !== 'hidden') void read()}, 2000)
    return () => {alive = false; window.clearInterval(timer)}
  }, [open, task?.id, task?.state, complete]) // eslint-disable-line react-hooks/exhaustive-deps
  const submit = async (retry = false) => {
    const token = generation.current
    setBusy(true); setError(null)
    try {
      const value = retry && task ? await dataApi.retry(task.id) : await dataApi.start(projectId, confirmation)
      if (token === generation.current) {
        setTask(retry && value.state !== 'completed' ? {...value, state: 'running'} : value)
        window.dispatchEvent(new Event('rayagent-cleanup-started'))
        if (value.state === 'completed') complete(value)
      }
    } catch (reason) {
      if (token !== generation.current) return
      setError(reason instanceof Error ? reason.message : '请求结果未确认，请重新读取')
      const latest = await dataApi.latest(projectId).catch(() => null)
      if (token === generation.current && latest && (latest.state !== 'completed' || latest.id !== baselineTask.current)) {
        setTask(latest)
        if (latest.state === 'completed') complete(latest)
      }
    } finally {if (token === generation.current) setBusy(false)}
  }
  const nonempty = preview && ['sessions', 'files', 'snapshots', 'bytes', 'memory'].some(key => preview.counts[key] > 0)
  const phrase = projectId ? nonempty ? preview?.name || '' : '' : '清空所有数据'
  return <Dialog open={open} onOpenChange={value => {if (!value && !busy) onClose()}}><DialogContent className="sm:max-w-[520px]" onOpenAutoFocus={event => {event.preventDefault(); document.getElementById('cleanup-cancel')?.focus()}}>
    <DialogHeader><DialogTitle>{projectId ? `删除${preview ? `“${preview.name}”` : '项目'}` : '清空所有项目与对话'}</DialogTitle><DialogDescription>{projectId ? '永久删除项目及其对话、文件、说明、笔记和文件保存点，无法恢复。' : '永久清空当前应用实例的全部项目（包括已归档项目）、独立对话、附件、项目文件、说明、笔记和文件保存点。模型与连接配置、执行权限、外观设置保留。'}</DialogDescription></DialogHeader>
    {task ? <div className="space-y-3"><p role="status" className="text-sm">{task.state === 'completed' ? '清理已完成' : task.state === 'failed' ? '清理未完成，已完成的删除无法撤销。' : `正在清理${task.phase}……`}</p><p className="text-meta text-muted-foreground tabular-nums">已处理 {task.completed} / {task.total} 项资源</p>{task.error && <p role="alert" className="text-sm text-state-failed">{task.error}</p>}{task.state === 'failed' && <Button variant="destructive" disabled={busy} onClick={() => void submit(true)}>重试清理</Button>}</div> : preview ? <div className="space-y-4"><p className="text-sm tabular-nums">{preview.counts.projects} 个项目，{preview.counts.sessions} 段对话，{preview.counts.files} 个附件，{preview.counts.snapshots} 个文件保存点</p>{preview.blocked_reason && <p role="alert" className="text-sm text-state-waiting">{preview.blocked_reason}{preview.occupying_session_id && <IconAction label="查看占用对话" className="ml-1 inline-flex align-middle text-signal" onClick={() => {if (onNavigate?.() === false) return; onClose(); router.push(`/sessions/${preview.occupying_session_id}`)}}><ArrowUpRight/></IconAction>}</p>}{phrase && <label className="block text-sm">输入“{phrase}”以确认<input autoComplete="off" value={confirmation} onChange={event => setConfirmation(event.target.value)} disabled={busy || !!preview.blocked_reason} className="mt-2 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"/></label>}</div> : !error && <p className="text-sm text-muted-foreground">正在核对删除范围……</p>}
    {error && <p role="alert" className="text-sm text-state-failed">{error}</p>}
    <div className="flex justify-end gap-2"><Button id="cleanup-cancel" variant="outline" disabled={busy} onClick={onClose}>{task ? '关闭' : '取消'}</Button>{!task && <><Button variant="ghost" disabled={busy} onClick={() => void load()}>重新核对</Button><Button variant="destructive" disabled={busy || !preview || !!preview.blocked_reason || confirmation !== phrase} onClick={() => void submit()}>{busy ? '正在受理' : projectId ? '永久删除项目' : '永久清空'}</Button></>}</div>
  </DialogContent></Dialog>
}
