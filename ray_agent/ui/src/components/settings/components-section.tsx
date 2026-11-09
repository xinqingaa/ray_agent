import {useEffect, useRef, useState} from 'react'
import {Button} from '@/components/ui/button'
import {componentsApi, type ComponentView} from '@/lib/api/components'
import {LoadError, SectionHeader} from './form'

const LABELS: Record<string, {name: string; description: string}> = {
  'browser-chromium': {name: '自动化浏览器', description: '供任务访问网页、操作页面和截图，与应用窗口分开运行。'},
  'embedding-e5': {name: '语义检索', description: '按内容含义检索工作区材料。未安装时仍可使用全文检索。'},
  ocr: {name: '文字识别', description: '读取扫描件和图片中的文字。'},
}
const STATES: Record<ComponentView['state'], string> = {
  not_installed: '未安装', fetching: '获取中', verifying: '校验中', available: '可用', failed: '安装失败', cancelled: '已取消',
}

/** 组件操作独立保存，离开设置或重启应用后仍能读取、取消和重试。 */
export function ComponentsSection() {
  const [items, setItems] = useState<ComponentView[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const requests = useRef<Record<string, string>>({})

  useEffect(() => {
    let disposed = false
    let timer: ReturnType<typeof setTimeout>
    const read = async () => {
      try {
        const rows = await componentsApi.list()
        if (!disposed) {
          for (const row of rows) {
            const key = `rayagent.component-install.${row.component_id}`
            try {
              if (row.operation?.request_id === sessionStorage.getItem(key)) {
                sessionStorage.removeItem(key)
                delete requests.current[row.component_id]
              }
            } catch {}
          }
          setItems(rows); setError(null)
        }
      } catch (reason) {
        if (!disposed) setError(reason instanceof Error ? reason.message : '读取组件失败')
      } finally {
        if (!disposed) timer = setTimeout(() => void read(), 2000)
      }
    }
    void read()
    return () => {disposed = true; clearTimeout(timer)}
  }, [revision])

  const act = async (item: ComponentView, action: 'install' | 'cancel' | 'retry') => {
    setBusy(item.component_id)
    setError(null)
    try {
      if (action === 'install') {
        const key = `rayagent.component-install.${item.component_id}`
        // 断连后复用同一请求；存储不可用时仍在本次挂载内保留身份。
        let requestId: string | undefined = requests.current[item.component_id]
        try {requestId ||= sessionStorage.getItem(key) ?? undefined} catch {}
        requestId ||= crypto.randomUUID()
        requests.current[item.component_id] = requestId
        try {sessionStorage.setItem(key, requestId)} catch {}
        await componentsApi.install(item.component_id, requestId)
        delete requests.current[item.component_id]
        try {sessionStorage.removeItem(key)} catch {}
      } else if (item.operation) {
        await componentsApi[action](item.operation.operation_id)
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '组件操作失败，请重新读取状态')
    } finally {
      setBusy(null)
      setRevision(value => value + 1)
    }
  }

  return <section aria-labelledby="settings-components-title" className="space-y-6">
    <SectionHeader id="settings-components-title" title="运行组件" description="按需安装任务需要的组件。安装进度会保留，关闭设置后仍可继续。"/>
    {error && <LoadError message={error} onRetry={() => setRevision(value => value + 1)}/>}
    {!items && !error && <p className="text-sm text-muted-foreground" role="status">正在读取组件…</p>}
    <div className="divide-y">
      {items?.map(item => {
        const label = LABELS[item.component_id] ?? {name: item.component_id, description: ''}
        const operation = item.operation
        const active = operation?.status === 'queued' || operation?.status === 'running'
        const cancelling = active && operation.cancel_requested_at != null
        return <div key={item.component_id} className="flex flex-wrap items-start justify-between gap-4 py-5 first:pt-0">
          <div className="min-w-0 flex-1 basis-64 space-y-1.5">
            <h3 className="text-sm font-medium">{label.name}</h3>
            <p className="text-sm text-muted-foreground">{label.description}</p>
            <p className="text-xs text-muted-foreground" role="status">
              {cancelling ? '正在取消' : active ? operation.status === 'queued' ? '等待安装' : operation.phase ?? '安装中' : STATES[item.state]}
              {item.version ? ` · ${item.version}` : item.size > 0 ? ` · 下载约 ${Math.ceil(item.size / 1024 / 1024)} MB` : ''}
            </p>
            {operation?.error && <p className="break-words text-xs text-destructive">{operation.error.message}</p>}
          </div>
          <div className="flex shrink-0 gap-2">
            {active ? <Button variant="outline" disabled={busy !== null || !operation.can_cancel} onClick={() => void act(item, 'cancel')}>{cancelling ? '正在取消' : '取消安装'}</Button>
              : operation?.can_retry ? <Button variant="outline" disabled={busy !== null} onClick={() => void act(item, 'retry')}>重试安装</Button>
              : (item.state !== 'available' || item.update_available) && <Button variant="outline" disabled={busy !== null} onClick={() => void act(item, 'install')}>{busy === item.component_id ? '正在受理' : item.version ? '更新' : '安装'}</Button>}
          </div>
        </div>
      })}
    </div>
  </section>
}
