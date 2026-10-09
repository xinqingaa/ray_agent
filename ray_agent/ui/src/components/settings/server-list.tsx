'use client'

import {useCallback, useEffect, useState, type ReactNode} from 'react'
import {useDeveloperMode} from '@/hooks/use-developer-mode'
import {Loader2, Trash2} from 'lucide-react'
import {toast} from 'sonner'
import {Button} from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {Skeleton} from '@/components/ui/skeleton'
import {Switch} from '@/components/ui/switch'
import type {ConnectionState} from '@/lib/api/types'
import {cn} from '@/lib/utils'
import {errorMessage} from './form'

// ---------- 列表加载与操作 ----------

type ListPhase = {phase: 'loading'} | {phase: 'error'; message: string} | {phase: 'ready'}

type ServerListOptions<T> = {
  load: () => Promise<T[]>
  keyOf: (item: T) => string
  nameOf: (item: T) => string
  setEnabled: (key: string, enabled: boolean) => Promise<void>
  remove: (key: string) => Promise<void>
}

/** MCP 与 A2A 列表共用：加载、启用开关乐观更新并在失败时回滚、删除 */
export function useServerList<T extends {enabled: boolean}>(options: ServerListOptions<T>) {
  const {load, keyOf, nameOf, setEnabled, remove} = options
  const [phase, setPhase] = useState<ListPhase>({phase: 'loading'})
  const [items, setItems] = useState<T[]>([])
  const [toggling, setToggling] = useState<Set<string>>(new Set())
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    load()
      .then((list) => {
        if (cancelled) return
        setItems(list)
        setPhase({phase: 'ready'})
      })
      .catch((err) => {
        if (!cancelled) setPhase({phase: 'error', message: errorMessage(err)})
      })
    return () => {
      cancelled = true
    }
  }, [load, attempt])

  const reload = useCallback(() => {
    setPhase({phase: 'loading'})
    setAttempt((n) => n + 1)
  }, [])

  /** 保存后静默刷新，拿到最新的连接状态 */
  const refresh = useCallback(async () => {
    try {
      setItems(await load())
    } catch {
      /* 列表保持当前内容 */
    }
  }, [load])

  const toggle = useCallback(async (item: T, enabled: boolean) => {
    const key = keyOf(item)
    setItems((prev) => prev.map((s) => (keyOf(s) === key ? {...s, enabled} : s)))
    setToggling((prev) => new Set(prev).add(key))
    try {
      await setEnabled(key, enabled)
      toast.success(`${nameOf(item)} 已${enabled ? '启用' : '停用'}`)
      await refresh()
    } catch (err) {
      setItems((prev) => prev.map((s) => (keyOf(s) === key ? {...s, enabled: !enabled} : s)))
      toast.error(`${enabled ? '启用' : '停用'}失败：${errorMessage(err)}`)
    } finally {
      setToggling((prev) => {
        const next = new Set(prev)
        next.delete(key)
        return next
      })
    }
  }, [keyOf, nameOf, setEnabled, refresh])

  const removeItem = useCallback(async (item: T) => {
    await remove(keyOf(item))
    setItems((prev) => prev.filter((s) => keyOf(s) !== keyOf(item)))
    toast.success(`已删除 ${nameOf(item)}`)
  }, [keyOf, nameOf, remove])

  return {phase, items, toggling, reload, refresh, toggle, remove: removeItem}
}

// ---------- 展示 ----------

const CONNECTION: Record<ConnectionState['connection_status'], {label: string; dot: string; text: string}> = {
  connected: {label: '已连接', dot: 'bg-state-success', text: 'text-state-success'},
  disabled: {label: '已停用', dot: 'bg-state-stopped', text: 'text-muted-foreground'},
  unavailable: {label: '不可用', dot: 'bg-state-failed', text: 'text-state-failed'},
}

export function ConnectionBadge({status}: {status: ConnectionState['connection_status']}) {
  const meta = CONNECTION[status]
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs', meta.text)}>
      <span className={cn('size-1.5 rounded-full', meta.dot)} aria-hidden/>
      {meta.label}
    </span>
  )
}

type ServerRowProps = {
  title: ReactNode
  /** 屏幕阅读器与确认框里的名称 */
  name: string
  status: ConnectionState['connection_status']
  error: string | null
  enabled: boolean
  toggling?: boolean
  meta?: ReactNode
  detail?: ReactNode
  onToggle?: (enabled: boolean) => void
  onDelete?: () => void
}

export function ServerRow({title, name, status, error, enabled, toggling, meta, detail, onToggle, onDelete}: ServerRowProps) {
  const {visibility} = useDeveloperMode()
  return (
    <li className="flex gap-4 py-3.5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="min-w-0 truncate text-sm font-medium">{title}</span>
          <ConnectionBadge status={status}/>
          {meta}
        </div>
        {detail && <div className="mt-1 text-xs leading-5 text-muted-foreground">{detail}</div>}
        {error && <p className="mt-1 break-words text-xs leading-5 text-state-failed">{error}</p>}
      </div>
      {visibility.connectionSettings && <div className="flex shrink-0 items-start gap-1 pt-0.5">
        <Switch
          checked={enabled}
          onCheckedChange={onToggle}
          disabled={!onToggle || toggling}
          aria-label={`${enabled ? '停用' : '启用'} ${name}`}
          className="mt-1"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="ml-2 text-muted-foreground hover:text-destructive"
          onClick={onDelete}
          disabled={!onDelete}
          aria-label={`删除 ${name}`}
        >
          <Trash2 aria-hidden/>
        </Button>
      </div>}
    </li>
  )
}

export function ListSkeleton() {
  return (
    <ul className="divide-y" aria-busy aria-label="正在加载">
      {[0, 1].map((i) => (
        <li key={i} className="space-y-2 py-4">
          <Skeleton className="h-4 w-48"/>
          <Skeleton className="h-3 w-72"/>
        </li>
      ))}
    </ul>
  )
}

export function EmptyList({children}: {children: ReactNode}) {
  return <p className="rounded-lg border border-dashed px-4 py-6 text-center text-meta text-muted-foreground">{children}</p>
}

// ---------- 删除确认 ----------

export function DeleteDialog({
  title,
  onCancel,
  onConfirm,
}: {
  /** 为空时关闭 */
  title: string | null
  onCancel: () => void
  onConfirm: () => Promise<void>
}) {
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const close = () => {
    if (deleting) return
    setError(null)
    onCancel()
  }

  const confirm = async () => {
    setDeleting(true)
    setError(null)
    try {
      await onConfirm()
      onCancel()
    } catch (err) {
      setError(errorMessage(err, '删除失败'))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Dialog open={title != null} onOpenChange={(open) => !open && close()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            删除后，下一次运行起不再提供它的工具；已有会话的记录不受影响。这一操作不能撤销。
          </DialogDescription>
        </DialogHeader>
        {error && <p role="alert" className="text-meta text-destructive">删除失败：{error}</p>}
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={deleting}>取消</Button>
          </DialogClose>
          <Button type="button" variant="destructive" onClick={confirm} disabled={deleting}>
            {deleting && <Loader2 className="animate-spin" aria-hidden/>}
            {deleting ? '正在删除' : '删除'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
