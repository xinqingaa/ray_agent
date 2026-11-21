import {useCallback, useEffect, useState} from 'react'
import {Button} from '@/components/ui/button'
import {DataCleanupDialog} from '@/components/data-cleanup-dialog'
import {dataApi, type CleanupTask} from '@/lib/api/data'
import {fileManagerName, getDataLocation, isDesktop, revealDataLocation} from '@/lib/platform'
import {errorMessage, SectionHeader} from './form'
import {SettingsRow} from './settings-row'

/** 数据根路径（mono）与在文件管理器中显示；只有桌面宿主能提供。 */
function DataLocationRow() {
  const available = isDesktop()
  const [path, setPath] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [revealError, setRevealError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!available) return
    let active = true
    getDataLocation().then(
      value => {if (active) {setPath(value); setLoadError(null)}},
      reason => {if (active) setLoadError(errorMessage(reason, '无法读取数据位置'))},
    )
    return () => {active = false}
  }, [available, attempt])
  const reveal = () => {
    setRevealError(null)
    revealDataLocation().catch(reason => setRevealError(errorMessage(reason, '无法打开数据位置')))
  }
  return <SettingsRow
    id="data-location"
    title="数据位置"
    description={available
      ? path
        ? <code className="block break-all font-mono text-xs text-foreground/80">{path}</code>
        : loadError ? null : '正在读取…'
      : '需要在 RayAgent 桌面应用中查看。'}
    error={loadError ?? revealError}
    control={available && <>
      {loadError && <Button type="button" variant="outline" size="sm" onClick={() => setAttempt(n => n + 1)}>重试</Button>}
      <Button type="button" variant="outline" size="sm" disabled={!path} onClick={reveal}>{`在 ${fileManagerName()} 中显示`}</Button>
    </>}
  />
}

/** 数据管理分区：数据位置，以及位于底部的清空全部数据（危险区）。 */
export function DataSection({disabledReason, onNavigate}: {
  disabledReason?: string
  onNavigate?: () => void | boolean
}) {
  const [open, setOpen] = useState(false), [pending, setPending] = useState<CleanupTask | null>(null), [error, setError] = useState<string | null>(null)
  const load = useCallback(async () => {
    try {const task = await dataApi.latest(); setPending(task?.state !== 'completed' ? task : null); setError(null)}
    catch (reason) {setError(reason instanceof Error ? reason.message : '读取状态失败')}
  }, [])
  useEffect(() => {const request = requestAnimationFrame(() => {void load()}); return () => cancelAnimationFrame(request)}, [load])
  return <section aria-labelledby="settings-data-title">
    <SectionHeader id="settings-data-title" title="数据管理"/>
    <div className="divide-y divide-border/70">
      <DataLocationRow/>
    </div>
    {pending && <div className="mb-4 rounded-[12px] bg-state-waiting-soft px-3.5 py-3 text-sm">
      <p>{pending.name}：{pending.state === 'failed' ? '清理失败，等待重试' : '正在清理'}</p>
      <Button type="button" variant="outline" size="sm" className="mt-2 bg-card" onClick={() => setOpen(true)}>查看清理任务</Button>
    </div>}
    {error && <p role="alert" className="mb-4 flex items-center gap-2 text-meta text-destructive">{error}<Button type="button" variant="ghost" size="xs" onClick={() => void load()}>重新读取</Button></p>}
    <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3 rounded-[14px] p-4 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--destructive)_25%,transparent)]">
      <div className="min-w-0 flex-1 basis-72">
        <h3 className="text-sm font-medium text-destructive">清空全部数据</h3>
        <p className="mt-1 text-meta leading-5 text-muted-foreground">
          删除全部对话、附件和工作区登记，包括工作区内的会话文件与写前备份；全局 Skill、模型与连接配置、执行权限及外观设置保留。工作区文件夹与其中的用户文件不会被删除。删除后无法恢复。
        </p>
        {disabledReason && <p className="mt-1.5 text-meta text-state-waiting">{disabledReason}</p>}
      </div>
      <Button type="button" variant="outline" className="shrink-0 text-destructive hover:text-destructive" disabled={!!disabledReason} title={disabledReason}
        onClick={() => setOpen(true)}>{pending ? '继续处理清理任务' : '清空…'}</Button>
    </div>
    <DataCleanupDialog onNavigate={onNavigate} open={open} onClose={() => {setOpen(false); void load()}} onCompleted={() => window.location.assign('/')}/>
  </section>
}
