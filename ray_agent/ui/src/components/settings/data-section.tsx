'use client'
import {useCallback, useEffect, useState} from 'react'
import {Button} from '@/components/ui/button'
import {DataCleanupDialog} from '@/components/data-cleanup-dialog'
import {dataApi, type CleanupTask} from '@/lib/api/data'

export function DataSection({disabledReason, onNavigate}: {disabledReason?: string; onNavigate?: () => void | boolean}) {
  const [open, setOpen] = useState(false), [pending, setPending] = useState<CleanupTask | null>(null), [error, setError] = useState<string | null>(null)
  const load = useCallback(async () => {
    try {const task = await dataApi.latest(); setPending(task?.state !== 'completed' ? task : null); setError(null)}
    catch (reason) {setError(reason instanceof Error ? reason.message : '读取状态失败')}
  }, [])
  useEffect(() => {const request = requestAnimationFrame(() => {void load()}); return () => cancelAnimationFrame(request)}, [load])
  return <section className="space-y-6"><div><h2 className="text-lg font-semibold">数据管理</h2><p className="mt-2 text-sm text-muted-foreground">管理当前应用实例中的项目与对话数据。</p></div>{pending && <div className="space-y-2 border-l-2 border-state-waiting pl-4"><p className="text-sm">{pending.name}：{pending.state === 'failed' ? '清理失败，等待重试' : '正在清理'}</p><Button variant="outline" onClick={() => setOpen(true)}>查看清理任务</Button></div>}<div className="space-y-3 border-t pt-6"><h3 className="text-sm font-semibold text-destructive">危险操作</h3><p className="text-sm">清空所有项目与对话</p><p className="max-w-xl text-sm text-muted-foreground">包括已归档项目、对话历史、附件、项目文件、说明、笔记和文件保存点。模型与连接配置、执行权限及外观设置保留。删除后无法恢复。</p><Button variant="outline" className="text-destructive hover:text-destructive" disabled={!!disabledReason} title={disabledReason} onClick={() => setOpen(true)}>{pending ? '继续处理清理任务' : '清空所有项目与对话'}</Button></div>{disabledReason && <p className="text-sm text-state-waiting">{disabledReason}</p>}{error && <p role="alert" className="text-sm text-state-failed">{error}<Button variant="ghost" onClick={() => void load()}>重新读取</Button></p>}<DataCleanupDialog onNavigate={onNavigate} open={open} onClose={() => {setOpen(false); void load()}} onCompleted={() => window.location.assign('/')}/></section>
}
