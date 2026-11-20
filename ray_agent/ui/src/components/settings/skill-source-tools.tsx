import {useRef, useState, type ReactNode} from 'react'
import {Button} from '@/components/ui/button'
import {Dialog, DialogContent, DialogTitle} from '@/components/ui/dialog'
import {ChevronDown, Folder, RefreshCw} from '@/components/ui/icons'
import {Switch} from '@/components/ui/switch'
import type {SkillSourcesPayload} from '@/lib/api/skills'

type SourceDirectory = SkillSourcesPayload['sources'][number]

function problemSummary(error: string) {
  if (error.startsWith('SKILL.md 格式错误')) {
    return error.includes('描述为空或过长') ? '描述为空或过长' : 'SKILL.md 格式有误'
  }
  if (error.startsWith('包大小超限')) return '包大小超限'
  return '扫描未通过'
}

export function SkillSourceTools({view, sources, initialGroup, busy, feedback, onClose, onRestoreFocus,
  onGroupChange, onDirectoryChange, onRescan, onAddDirectory, onRemoveDirectory, canAddDirectory}: {
  view: 'sources' | 'issues'
  sources: SkillSourcesPayload
  initialGroup: string
  busy: boolean
  feedback: ReactNode
  onClose: () => void
  onRestoreFocus: () => void
  onGroupChange: (group: string, enabled: boolean) => void
  onDirectoryChange: (id: string, enabled: boolean) => void
  onRescan: () => void
  onAddDirectory: () => void
  onRemoveDirectory: (path: string) => void
  canAddDirectory: boolean
}) {
  const title = useRef<HTMLHeadingElement>(null)
  const [selected, setSelected] = useState(initialGroup)
  const group = sources.groups.find(item => item.id === selected) ?? sources.groups[0]
  const directories = sources.sources.filter(source => source.group === group?.id)
  const problems = sources.sources.flatMap(source => source.problems.map(problem => ({source, ...problem})))

  return <Dialog open onOpenChange={next => {if (!next && !busy) onClose()}}>
    <DialogContent aria-describedby={undefined} className="skill-source-dialog @container/sources flex max-w-none flex-col gap-0 overflow-hidden rounded-[22px] border-0 p-0 shadow-(--float-shadow) sm:max-w-none"
      onPointerDownOutside={event => event.preventDefault()}
      onOpenAutoFocus={event => {event.preventDefault(); title.current?.focus({preventScroll: true})}}
      onCloseAutoFocus={event => {event.preventDefault(); onRestoreFocus()}}>
      <header className="flex min-h-16 shrink-0 items-center gap-3 px-6 pr-14">
        <DialogTitle ref={title} tabIndex={-1} className="outline-none">{view === 'sources' ? '管理来源' : '扫描问题'}</DialogTitle>
        {view === 'issues' && <Button variant="ghost" size="sm" className="ml-auto" disabled={busy} onClick={onRescan}>
          <RefreshCw className={busy ? 'animate-spin motion-reduce:animate-none' : undefined}/>{busy ? '正在扫描' : '重新扫描'}
        </Button>}
      </header>
      {view === 'sources' ? <div className="flex min-h-0 flex-1 flex-col @xl/sources:flex-row">
        <nav aria-label="来源组" className="flex shrink-0 gap-1 overflow-x-auto bg-muted/55 px-3 py-2 @xl/sources:w-44 @xl/sources:flex-col @xl/sources:overflow-y-auto @xl/sources:py-4">
          {sources.groups.map(item => <button type="button" className="skill-source-filter whitespace-nowrap"
            key={item.id} aria-current={item.id === group?.id ? 'true' : undefined} onClick={() => setSelected(item.id)}>
            <span>{item.label}</span><span className="skill-source-count">{item.count}</span>
          </button>)}
        </nav>
        {group && <div className="min-h-0 min-w-0 flex-1 space-y-5 overflow-y-auto p-5 @xl/sources:px-7">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-base font-semibold">{group.label}</h3>
            <label className="flex items-center gap-2 text-sm">
              <span>启用 {group.label} 来源</span>
              <Switch size="sm" className="skill-source-switch" checked={group.enabled} disabled={busy}
                onCheckedChange={checked => onGroupChange(group.id, checked)}/>
            </label>
          </div>
          <p className="text-xs text-muted-foreground">影响所有工作区的新任务。重新启用后恢复原有目录和 Skill 设置。</p>
          {feedback}
          {directories.length === 0 && <p className="text-sm text-muted-foreground">尚未配置目录</p>}
          <ul className="space-y-4">
            {directories.map(source => <li key={source.source_id} className="flex min-w-0 items-start gap-3">
              <div className="min-w-0 flex-1 space-y-1">
                <p className="break-words text-sm">{source.label}</p>
                <p className="break-all font-mono text-xs text-muted-foreground">{source.path}</p>
                {source.kind === 'extra' && <Button variant="ghost" size="xs" disabled={busy}
                  onClick={() => onRemoveDirectory(source.path)}>移除目录</Button>}
              </div>
              <DirectoryState source={source} groupEnabled={group.enabled} busy={busy} onChange={onDirectoryChange}/>
            </li>)}
          </ul>
          {group.id === 'extra' && <Button variant="outline" size="sm" disabled={busy || !canAddDirectory}
            onClick={onAddDirectory}><Folder/>添加额外目录</Button>}
        </div>}
      </div> : <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 pb-6 pt-1">
        {feedback}
        <p aria-live="polite" className="text-sm text-muted-foreground">{problems.length ? `有 ${problems.length} 项扫描问题，相关 Skill 可能无法使用。` : '暂无扫描问题。'}</p>
        <ul className="space-y-1">
          {problems.map(({source, path, error}, index) => <li key={`${source.source_id}:${path}:${index}`}>
            <details className="skill-scan-issue rounded-lg">
              <summary className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 focus-visible:outline-2 focus-visible:outline-ring">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{problemName(source, path)}</span>
                  <span className="block truncate text-xs text-muted-foreground">{source.label} · {problemSummary(error)}</span>
                </span>
                <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden/>
              </summary>
              <div className="space-y-1 px-3 pb-3 text-xs text-muted-foreground">
                <p>{error}</p><p className="break-all font-mono">{path}</p>
              </div>
            </details>
          </li>)}
        </ul>
      </div>}
    </DialogContent>
  </Dialog>
}

function DirectoryState({source, groupEnabled, busy, onChange}: {
  source: SourceDirectory; groupEnabled: boolean; busy: boolean; onChange: (id: string, enabled: boolean) => void
}) {
  if (!groupEnabled || !source.exists) {
    return <span className="shrink-0 text-xs text-muted-foreground">{groupEnabled ? '目录未找到' : '随来源停用'}</span>
  }
  return <Switch className="skill-source-switch" size="sm" checked={source.enabled} disabled={busy}
    aria-label={`启用 ${source.label} 目录`} onCheckedChange={checked => onChange(source.source_id, checked)}/>
}

function problemName(source: SourceDirectory, path: string) {
  if (path === source.path) return '目录扫描问题'
  const parts = path.split(/[\\/]/).filter(Boolean)
  if (parts.at(-1) === 'SKILL.md') parts.pop()
  return parts.at(-1) ?? source.label
}
