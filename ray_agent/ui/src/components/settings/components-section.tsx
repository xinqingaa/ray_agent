import {useEffect, useRef} from 'react'
import {Button} from '@/components/ui/button'
import {useRuntimeComponents} from '@/hooks/use-runtime-components'
import type {ComponentView} from '@/lib/api/components'
import {VOICE_COMPONENT_ID} from '@/lib/voice-options'
import {LoadError, SectionHeader} from './form'
import {Globe, Package} from '@/components/ui/icons'
import {cn, formatFileSize} from '@/lib/utils'
import {useSearchParams} from 'react-router'
import {Link} from '@/lib/navigation'

const LABELS: Record<string, {name: string; description: string}> = {
  'browser-chromium': {name: '自动化浏览器', description: '供任务访问网页、操作页面和截图，与应用窗口分开运行。'},
  'embedding-e5': {name: '语义检索', description: '按内容含义检索工作区材料。未安装时仍可使用全文检索。'},
  ocr: {name: '文字识别', description: '读取扫描件和图片中的文字。'},
  [VOICE_COMPONENT_ID]: {name: '本机语音转写', description: '用于在设备上识别普通话和英语录音。'},
}
const STATES: Record<ComponentView['state'], string> = {
  unsupported: '不可用', not_installed: '未安装', fetching: '获取中', verifying: '校验中', available: '可用', failed: '安装失败', cancelled: '已取消',
}

/** 组件操作独立保存，离开设置或重启应用后仍能读取、取消和重试。 */
export function RuntimeComponentsPage() {
  const [params] = useSearchParams()
  const back = params.get('return')
  const component = params.get('component')
  const returnTo = back && /^\/workspaces\/[\w-]+\/knowledge(?:\?|$)/.test(back) ? back : null
  return <main className="overflow-y-auto px-6 py-7 sm:px-9"><div className="mx-auto max-w-5xl">
    {returnTo && <Button asChild size="sm" variant="ghost" className="mb-3"><Link href={returnTo}>返回知识</Link></Button>}
    <ComponentsSection standalone focusComponent={component}/>
  </div></main>
}

export function ComponentsSection({standalone = false, focusComponent}: {
  standalone?: boolean; focusComponent?: string | null
} = {}) {
  const {items, error, busy, act, refresh} = useRuntimeComponents()
  const focused = useRef<string | null>(null)
  const focusRow = useRef<HTMLDivElement | null>(null)
  const hasFocusRow = !!items?.some(item => item.component_id === focusComponent)

  useEffect(() => {
    if (focusComponent && hasFocusRow && focused.current !== focusComponent) {
      focused.current = focusComponent
      focusRow.current?.focus({preventScroll: true})
      focusRow.current?.scrollIntoView({block: 'nearest'})
    }
  }, [focusComponent, hasFocusRow])

  return <section aria-labelledby="settings-components-title" className="space-y-6">
    <SectionHeader id="settings-components-title" title="运行组件" description="按需安装任务需要的组件。安装进度会保留，关闭设置后仍可继续。"/>
    {error && <LoadError message={error} onRetry={refresh}/>}
    {!items && !error && <p className="text-sm text-muted-foreground" role="status">正在读取组件…</p>}
    <div className={standalone ? "space-y-3" : "divide-y"}>
      {items?.map(item => {
        const label = LABELS[item.component_id] ?? {name: item.component_id, description: ''}
        const operation = item.state === 'unsupported' ? null : item.operation
        const active = operation?.status === 'queued' || operation?.status === 'running'
        const cancelling = active && operation.cancel_requested_at != null
        const progress = item.state === 'fetching' && operation?.status === 'running' && !cancelling ? operation.progress : null
        return <div key={item.component_id} ref={item.component_id === focusComponent ? focusRow : undefined}
          tabIndex={item.component_id === focusComponent ? -1 : undefined} className={cn('flex flex-wrap items-start justify-between gap-4',
          standalone ? 'rounded-xl px-4 py-4' : 'py-5 first:pt-0',
          standalone && (active || item.state === 'failed') && 'bg-muted shadow-(--paper-shadow)')}>
          {standalone && <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-signal-soft text-signal">
            {item.component_id === 'browser-chromium' ? <Globe className="size-5"/> : <Package className="size-5"/>}
          </span>}
          <div className="min-w-0 flex-1 basis-64 space-y-1.5">
            <h3 className="text-sm font-medium">{label.name}</h3>
            <p className="text-sm text-muted-foreground">{label.description}</p>
            <p className="text-xs text-muted-foreground" role="status">
              {cancelling ? '正在取消' : active ? operation.status === 'queued' ? '等待安装' : operation.phase ?? '安装中' : STATES[item.state]}
              {item.version ? ` · ${item.version}` : item.size > 0 ? ` · 下载约 ${Math.ceil(item.size / 1024 / 1024)} MB` : ''}
            </p>
            {progress?.total ? <div className="flex items-center gap-2 text-xs tabular-nums text-faint">
              <progress className="h-1.5 min-w-0 flex-1 accent-(--signal)" aria-label={`${label.name}获取进度`}
                value={progress.completed} max={progress.total}/>
              <span>{formatFileSize(progress.completed)} / {formatFileSize(progress.total)}</span>
            </div> : null}
            {operation?.error && <p className="break-words text-xs text-destructive">{operation.error.message}</p>}
            {item.state === 'unsupported' && <p className="text-xs text-muted-foreground">{item.error?.message}</p>}
          </div>
          <div className="flex shrink-0 gap-2">
            {active ? <Button variant="outline" disabled={busy !== null || !operation.can_cancel} onClick={() => void act(item, 'cancel')}>{cancelling ? '正在取消' : '取消安装'}</Button>
              : operation?.can_retry ? <Button variant="outline" disabled={busy !== null} onClick={() => void act(item, 'retry')}>重试安装</Button>
              : item.state !== 'unsupported' && (item.state !== 'available' || item.update_available) && <Button variant="outline" disabled={busy !== null} onClick={() => void act(item, 'install')}>{busy === item.component_id ? '正在受理' : item.version ? '更新' : '安装'}</Button>}
          </div>
        </div>
      })}
    </div>
  </section>
}
