import {Button} from '@/components/ui/button'
import {useRuntimeComponents} from '@/hooks/use-runtime-components'
import {formatFileSize} from '@/lib/utils'
import {VOICE_COMPONENT_ID} from '@/lib/voice-options'

export function useVoiceModel(enabled: boolean, poll: boolean) {
  const components = useRuntimeComponents(enabled, poll)
  const item = components.items?.find(row => row.component_id === VOICE_COMPONENT_ID)
  return {...components, item}
}

export function VoiceModelStatus({model}: {model: ReturnType<typeof useVoiceModel>}) {
  const {item, items, error, busy, refresh, act} = model
  if (error && !item) return <div role="status" className="flex flex-wrap items-center gap-2">
    <span>{error}</span><Button type="button" size="xs" variant="outline" onClick={refresh}>重新读取</Button>
  </div>
  if (!item) return <span role="status">{items ? '当前版本未提供本机语音模型。' : '正在读取本机模型状态…'}</span>
  if (item.state === 'unsupported') return <span role="status">{item.error?.message ?? '当前设备无法使用本机转写。'}</span>
  if (item.state === 'available') return <span role="status">模型已就绪 · {formatFileSize(item.size)}</span>

  const operation = item.operation
  const active = operation?.status === 'queued' || operation?.status === 'running'
  const progress = active && operation.progress?.total ? operation.progress : null
  const pending = busy !== null || (active && operation.cancel_requested_at != null)
  const action = active ? 'cancel' : operation?.can_retry ? 'retry' : 'install'
  const label = {cancel: '取消下载', retry: '重试下载', install: '下载模型'}[action]
  const status = active ? operation.phase ?? '等待下载'
    : item.state === 'failed' ? '模型下载失败' : item.state === 'cancelled' ? '下载已取消' : '模型未下载'
  const message = error ?? operation?.error?.message ?? item.error?.message

  return <div className="space-y-1">
    <div className="flex flex-wrap items-center gap-2">
      <span role="status">{status} · {formatFileSize(item.size)}</span>
      <Button type="button" size="xs" variant="outline" disabled={pending || (active && !operation.can_cancel)}
        onClick={() => void act(item, action)}>{label}</Button>
    </div>
    {progress && <div className="flex items-center gap-2 tabular-nums">
      <progress className="h-1.5 min-w-0 flex-1 accent-(--signal)" aria-label="本机语音模型下载进度"
        value={progress.completed} max={progress.total ?? undefined}/>
      <span>{formatFileSize(progress.completed)}</span>
    </div>}
    {message && <p role="alert" className="text-destructive">{message}</p>}
  </div>
}
