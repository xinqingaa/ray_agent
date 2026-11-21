import {useEffect, useRef, useState} from 'react'
import {componentsApi, type ComponentView} from '@/lib/api/components'

export function useRuntimeComponents(enabled = true, poll = true) {
  const [items, setItems] = useState<ComponentView[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const requests = useRef<Record<string, string>>({})
  const refresh = () => setRevision(value => value + 1)

  useEffect(() => {
    if (!enabled) return
    let disposed = false
    let timer: ReturnType<typeof setTimeout>
    const read = async () => {
      try {
        const rows = await componentsApi.list()
        if (disposed) return
        for (const row of rows) {
          const key = `rayagent.component-install.${row.component_id}`
          try {
            if (row.operation?.request_id === sessionStorage.getItem(key)) {
              sessionStorage.removeItem(key)
              delete requests.current[row.component_id]
            }
          } catch {}
        }
        setItems(rows)
        setError(null)
      } catch (reason) {
        if (!disposed) setError(reason instanceof Error ? reason.message : '读取组件失败')
      } finally {
        if (!disposed && poll) timer = setTimeout(() => void read(), 2000)
      }
    }
    void read()
    return () => {disposed = true; clearTimeout(timer)}
  }, [enabled, poll, revision])

  const act = async (item: ComponentView, action: 'install' | 'cancel' | 'retry') => {
    setBusy(item.component_id)
    setError(null)
    try {
      if (action === 'install') {
        const key = `rayagent.component-install.${item.component_id}`
        // 断连时复用同一次安装请求。
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
      refresh()
    }
  }

  return {items, error, busy, act, refresh}
}
