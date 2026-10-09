'use client'
import Link from 'next/link'
import {Button} from '@/components/ui/button'
import type {ProjectDetails, ProjectView} from '@/lib/api/types'
import {projectApi} from '@/lib/api/project'
import {formatBytes} from '@/components/run/format'
import {useState} from 'react'

export function projectWriteReason(project: ProjectDetails | null): string | null {
  if(!project)return '正在读取项目状态'
  if(!project.available)return project.reason || '项目存储不可用'
  if(project.archived)return '项目已归档，请恢复后操作'
  if(project.file_operation)return project.write_blocked_reason || '项目文件操作尚未结束'
  if(project.occupying_session_id)return '项目有正在运行或等待处理的对话，请先回复或停止'
  return null
}

export function ProjectStateNotice({project,onChanged,showStats = true}: {showStats?: boolean;project: ProjectView & {occupying_session_id?: string | null};onChanged?: () => void}) {
  const [busy,setBusy]=useState(false),[error,setError]=useState<string | null>(null)
  const op=project.file_operation
  const retry=async () => {
    setBusy(true);setError(null)
    try {if(op?.kind==='settling')await projectApi.retrySettling(project.id);else if(op)await projectApi.reconcile(project.id,op.operation_id);onChanged?.()}
    catch(error){setError(error instanceof Error ? error.message : '核对失败，请重试')}
    finally{setBusy(false);onChanged?.()}
  }
  if (!showStats && !op && !['skipped', 'failed'].includes(project.protection?.state ?? '') && !project.snapshot_gc_pending && !error) return null
  return <div className="space-y-2 text-meta">
    {showStats && <p className="text-faint tabular-nums">文件总量 {formatBytes(project.files_size)}{project.files_size_stale || project.occupying_session_id ? '（上次统计，运行中可能变化）' : ''}{project.files_size_at && <span className="ml-2">{new Date(project.files_size_at).toLocaleString()}</span>}</p>}
    {project.protection?.state==='skipped' && <p className="border-l-2 border-state-waiting pl-2 text-state-waiting">当前运行未受快照保护：{project.protection.reason || '项目超过快照大小上限'}。可继续运行或单文件下载；请精简材料，上传和整项目下载仍受大小限制。</p>}
    {project.protection?.state==='failed' && <p className="text-state-failed">运行前保护失败：{project.protection.reason || project.protection.error}。本次未执行，请修复后再开始。</p>}
    {op && <div className="border-l-2 border-state-waiting pl-2"><p>{op.kind==='settling' ? op.state==='failed' ? '项目环境收尾失败' : '正在收尾项目环境' : op.kind==='restore' ? op.state==='failed' ? '恢复未完成，文件可能处于混合状态' : '正在恢复项目文件' : op.kind==='upload' ? '项目上传批次尚未结束' : '项目文件操作尚未结束'}{op.error && `：${op.error}`}</p><p className="text-faint">操作结束前不能新运行、上传、恢复、归档或清理。历史和文件仍可查看。</p>
      {op.state==='failed' && op.kind==='settling' && <Button variant="outline" size="sm" disabled={busy} onClick={() => void retry()}>重试环境收尾</Button>}
      {op.state==='failed' && op.kind!=='settling' && !(op.kind==='restore' && op.before_snapshot_id) && <Button variant="outline" size="sm" disabled={busy} onClick={() => void retry()}>核对文件操作</Button>}
      {op.session_id && <Link className="ml-2 text-signal underline" href={`/sessions/${op.session_id}`}>查看关联对话</Link>}
    </div>}
    {project.snapshot_gc_pending && <p className="text-state-waiting">快照对象清理尚未完成，记录保留供再次核对。</p>}
    {error && <p role="alert" className="text-state-failed">{error}</p>}
  </div>
}
