import {useEffect, useRef, useState, type CSSProperties} from 'react'
import {useSearchParams} from 'react-router'
import {Button} from '@/components/ui/button'
import {DangerConfirmDialog} from '@/components/ui/danger-confirm-dialog'
import {IconAction} from '@/components/ui/icon-action'
import {
  Check, ComponentInstall, ComponentUninstall, Globe, Loader2, Mic, Package, RotateCw, Scan, Search, X,
} from '@/components/ui/icons'
import {useRuntimeComponents} from '@/hooks/use-runtime-components'
import type {ComponentView} from '@/lib/api/components'
import {Link} from '@/lib/navigation'
import {cn, formatFileSize} from '@/lib/utils'
import {VOICE_COMPONENT_ID} from '@/lib/voice-options'
import {LoadError, SectionHeader} from './form'

export type ComponentMeta = {
  name: string
  after: string
  before: string
  uninstallImpact: string
  preserved: string
}

export const COMPONENT_META: Record<string, ComponentMeta> = {
  'browser-chromium': {
    name: '自动化浏览器',
    after: '供任务在独立浏览器中访问动态网页、操作页面元素与截图。',
    before: '未安装时，联网搜索、公开网页正文读取及系统浏览器打开成果仍正常可用。',
    uninstallImpact: '移除本机 Chromium 程序，任务将无法执行自动化浏览器操作。',
    preserved: '保留各工作区的浏览器资料目录（登录态与缓存），重装后可直接恢复。',
  },
  'embedding-e5': {
    name: '语义检索',
    after: '为工作区材料建立语义索引，按内容含义召回相关片段。',
    before: '未安装时，本机全文检索始终可用，仍可按关键词搜索材料、记忆与摘要。',
    uninstallImpact: '移除本机 Embedding 模型，工作区检索自动回退为全文检索。',
    preserved: '保留工作区原文件、全文索引与已有向量索引，重装后可继续恢复。',
  },
  ocr: {
    name: '文字识别',
    after: '在本机识别扫描 PDF 与图片中的文字并写入工作区索引。',
    before: '未安装时，随消息发送图片给支持视觉的模型直接识图不受影响。',
    uninstallImpact: '移除本机 OCR 模型，新增扫描件与图片将暂不进行文字识别索引。',
    preserved: '保留工作区原文件与已完成识别的索引内容，重装后可继续补录。',
  },
  [VOICE_COMPONENT_ID]: {
    name: '本机语音转写',
    after: '在设备本机离线识别普通话和英语录音并转成文字。',
    before: '未安装时，可在通用设置中改用远程语音转写（DeepSeek）或直接文字输入。',
    uninstallImpact: '移除本机 Whisper 语音模型，本机离线语音转写将暂停使用。',
    preserved: '保留对话草稿、录音偏好与历史消息，重装后即可恢复。',
  },
}

const STATES: Record<ComponentView['state'], string> = {
  unsupported: '不可用',
  not_installed: '未安装',
  fetching: '获取中',
  verifying: '正在校验',
  available: '已安装',
  failed: '安装失败',
  cancelled: '已取消',
}

type ProgressStage = 'queued' | 'fetching' | 'indeterminate' | 'verifying' | 'cancelling'

function resolveProgressStage(item: ComponentView): {
  stage: ProgressStage
  percent: number | null
  fillPercent: number
  stageText: string
  detailText: string | null
} | null {
  const operation = item.state === 'unsupported' ? null : item.operation
  const active = operation?.status === 'queued' || operation?.status === 'running'
  if (!active || !operation) return null
  if (operation.cancel_requested_at != null) {
    return {stage: 'cancelling', percent: null, fillPercent: 25, stageText: '正在取消', detailText: null}
  }
  if (operation.status === 'queued') {
    return {stage: 'queued', percent: null, fillPercent: 16, stageText: '等待中', detailText: null}
  }
  const verifying = item.state === 'verifying' || operation.phase === '校验中' || operation.phase === '准备校验'
  if (verifying) {
    return {stage: 'verifying', percent: 100, fillPercent: 100, stageText: '正在校验', detailText: null}
  }
  const progress = operation.progress
  if (progress?.total && progress.total > 0) {
    const ratio = Math.max(0, Math.min(1, progress.completed / progress.total))
    const percent = Math.round(ratio * 100)
    return {
      stage: 'fetching',
      percent,
      fillPercent: Math.max(10, percent),
      stageText: `${percent}%`,
      detailText: `${formatFileSize(progress.completed)} / ${formatFileSize(progress.total)}`,
    }
  }
  return {
    stage: 'indeterminate',
    percent: null,
    fillPercent: 48,
    stageText: '下载中',
    detailText: progress?.completed ? formatFileSize(progress.completed) : null,
  }
}

function ComponentIcon({componentId}: {componentId: string}) {
  if (componentId === 'browser-chromium') return <Globe className="size-5"/>
  if (componentId === 'embedding-e5') return <Search className="size-5"/>
  if (componentId === 'ocr') return <Scan className="size-5"/>
  if (componentId === VOICE_COMPONENT_ID) return <Mic className="size-5"/>
  return <Package className="size-5"/>
}

function ComponentWaterProgress({name, stage, percent, fillPercent, stageText, detailText}: {
  name: string
  stage: ProgressStage
  percent: number | null
  fillPercent: number
  stageText: string
  detailText: string | null
}) {
  return <div className="flex items-center gap-2.5">
    <div className="text-right text-xs tabular-nums">
      <div className="font-medium text-foreground" role="status">{stageText}</div>
      {detailText && <div className="text-faint">{detailText}</div>}
    </div>
    <div
      role="progressbar"
      aria-label={`${name}安装进度`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent ?? undefined}
      aria-valuetext={detailText ? `${stageText}（${detailText}）` : stageText}
      data-stage={stage}
      className="component-water-meter"
      style={{'--water-level': `${fillPercent}%`} as CSSProperties}
    >
      <div className="component-water-fill" aria-hidden="true">
        <svg className="component-water-wave component-water-wave-back" viewBox="0 0 120 12" preserveAspectRatio="none">
          <path d="M0 6 Q15 1 30 6 T60 6 T90 6 T120 6 V12 H0 Z"/>
        </svg>
        <svg className="component-water-wave component-water-wave-front" viewBox="0 0 120 12" preserveAspectRatio="none">
          <path d="M0 6 Q15 11 30 6 T60 6 T90 6 T120 6 V12 H0 Z"/>
        </svg>
        <div className="component-water-body"/>
      </div>
      <span className="component-water-glyph" aria-hidden="true">
        {stage === 'verifying' ? <Check className="size-4"/> : <ComponentInstall className="size-4"/>}
      </span>
    </div>
  </div>
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
  const {items, error, busy, act, uninstall, refresh} = useRuntimeComponents()
  const [uninstallTarget, setUninstallTarget] = useState<ComponentView | null>(null)
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

  const targetMeta = uninstallTarget
    ? COMPONENT_META[uninstallTarget.component_id] ?? {
      name: uninstallTarget.component_id,
      after: '',
      before: '',
      uninstallImpact: '移除该组件本地程序文件，相关增强能力将暂停使用。',
      preserved: '保留工作区原文件与已有数据，重装后可恢复。',
    }
    : null

  return <section aria-labelledby="settings-components-title" className="space-y-6">
    <SectionHeader id="settings-components-title" title="运行组件" description="按需安装增强组件；未安装时基础能力仍可用，安装进度离开页面后继续保留。"/>
    {error && <LoadError message={error} onRetry={refresh}/>}
    {!items && !error && <p className="text-sm text-muted-foreground" role="status">正在读取组件…</p>}
    <div className={standalone ? 'space-y-3' : 'divide-y'}>
      {items?.map(item => {
        const meta = COMPONENT_META[item.component_id] ?? {
          name: item.component_id, after: '', before: '', uninstallImpact: '', preserved: '',
        }
        const operation = item.state === 'unsupported' ? null : item.operation
        const active = operation?.status === 'queued' || operation?.status === 'running'
        const cancelling = active && operation.cancel_requested_at != null
        const water = resolveProgressStage(item)
        const isBusy = busy === item.component_id
        const stateText = cancelling ? '正在取消'
          : water ? water.stageText
          : STATES[item.state]
        return <div key={item.component_id} ref={item.component_id === focusComponent ? focusRow : undefined}
          tabIndex={item.component_id === focusComponent ? -1 : undefined}
          className={cn(
            'flex flex-wrap items-start justify-between gap-4',
            standalone ? 'rounded-xl px-4 py-4' : 'py-5 first:pt-0',
            standalone && (active || item.state === 'failed') && 'bg-muted shadow-(--paper-shadow)',
          )}>
          {standalone && <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-signal-soft text-signal">
            <ComponentIcon componentId={item.component_id}/>
          </span>}
          <div className="min-w-0 flex-1 basis-64 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-medium">{meta.name}</h3>
              <span className={cn(
                'rounded-md px-1.5 py-0.5 text-xs',
                item.state === 'available' ? 'bg-state-success-soft text-state-success'
                  : item.state === 'failed' ? 'bg-state-failed-soft text-state-failed'
                  : active ? 'bg-signal-soft text-signal'
                  : 'bg-muted text-muted-foreground',
              )} role="status">{stateText}</span>
              <span className="text-xs tabular-nums text-faint">
                {item.version ? item.version : item.size > 0 ? `约 ${Math.ceil(item.size / 1024 / 1024)} MB` : ''}
              </span>
            </div>
            {meta.after && <p className="text-sm text-foreground/90">{meta.after}</p>}
            {meta.before && <p className="text-xs text-muted-foreground">{meta.before}</p>}
            {operation?.error && <p className="break-words text-xs text-destructive" role="alert">{operation.error.message}</p>}
            {item.state === 'unsupported' && item.error?.message && <p className="text-xs text-muted-foreground">{item.error.message}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-1.5 self-center">
            {water ? <>
              <ComponentWaterProgress
                name={meta.name}
                stage={water.stage}
                percent={water.percent}
                fillPercent={water.fillPercent}
                stageText={water.stageText}
                detailText={water.detailText}
              />
              <IconAction
                label={cancelling ? '正在取消安装' : `取消安装${meta.name}`}
                disabled={busy !== null || !operation?.can_cancel || cancelling}
                onClick={() => void act(item, 'cancel')}
              >
                <X className="size-4"/>
              </IconAction>
            </> : <>
              {operation?.can_retry && item.state !== 'available' ? (
                <IconAction
                  label={`重试安装${meta.name}`}
                  disabled={busy !== null}
                  onClick={() => void act(item, 'retry')}
                >
                  {isBusy ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none"/> : <RotateCw className="size-4"/>}
                </IconAction>
              ) : item.state !== 'unsupported' && (item.state !== 'available' || item.update_available) ? (
                <IconAction
                  label={item.version ? `更新${meta.name}` : `安装${meta.name}`}
                  disabled={busy !== null}
                  onClick={() => void act(item, 'install')}
                >
                  {isBusy ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none"/> : <ComponentInstall className="size-4"/>}
                </IconAction>
              ) : null}
              {item.state === 'available' && (
                <IconAction
                  label={`卸载${meta.name}`}
                  disabled={busy !== null}
                  onClick={() => setUninstallTarget(item)}
                >
                  <ComponentUninstall className="size-4"/>
                </IconAction>
              )}
            </>}
          </div>
        </div>
      })}
    </div>
    <DangerConfirmDialog
      open={uninstallTarget !== null}
      onOpenChange={open => {if (!open) setUninstallTarget(null)}}
      title={targetMeta ? `卸载「${targetMeta.name}」？` : '卸载组件？'}
      description="卸载只删除本机组件程序或模型文件，不会删除你的工作区原文件。"
      confirmLabel="确认卸载"
      busyLabel="正在卸载"
      onConfirm={async () => {
        if (!uninstallTarget) return
        await uninstall(uninstallTarget)
      }}
    >
      {targetMeta && <div className="space-y-2 rounded-lg bg-muted/60 px-3 py-2.5 text-xs leading-relaxed">
        <p><span className="font-medium text-foreground">卸载影响：</span><span className="text-muted-foreground">{targetMeta.uninstallImpact}</span></p>
        <p><span className="font-medium text-foreground">保留内容：</span><span className="text-muted-foreground">{targetMeta.preserved}</span></p>
      </div>}
    </DangerConfirmDialog>
  </section>
}
