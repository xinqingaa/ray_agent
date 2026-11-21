import {AlertCircle, Loader2, RotateCcw} from '@/components/ui/icons'
import {useCallback, useEffect, useRef, useState, type ReactNode} from 'react'
import {toast} from 'sonner'
import {Button} from '@/components/ui/button'
import {Skeleton} from '@/components/ui/skeleton'

export function errorMessage(err: unknown, fallback = '请求失败'): string {
  if (err instanceof TypeError) return '无法连接 API 服务，请确认服务已启动'
  if (err instanceof Error && err.message) return err.message
  return fallback
}

// ---------- 分区外框 ----------

/** 分区标题：无分隔线，说明写在标题下方；右侧留出设置页关闭按钮的位置。 */
export function SectionHeader({id, title, description, action}: {id: string; title: string; description?: ReactNode; action?: ReactNode}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3 pr-12 pb-4">
      <div className="min-w-0 max-w-prose">
        <h2 id={id} className="text-lg font-semibold tracking-tight">{title}</h2>
        {description ? <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{description}</p> : null}
      </div>
      {action}
    </header>
  )
}

export function LoadError({message, onRetry}: {message: string; onRetry: () => void}) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg bg-state-failed-soft px-3.5 py-3 text-sm">
      <AlertCircle className="size-4 shrink-0 text-state-failed" aria-hidden/>
      <span className="min-w-0 flex-1">
        <span className="font-medium text-state-failed">加载失败</span>
        <span className="ml-2">{message}</span>
      </span>
      <Button type="button" size="sm" variant="outline" className="bg-card" onClick={onRetry}>
        <RotateCcw aria-hidden/>
        重试
      </Button>
    </div>
  )
}

export function FormSkeleton({rows}: {rows: number}) {
  return (
    <div className="space-y-6 py-5" aria-busy aria-label="正在加载">
      {Array.from({length: rows}, (_, i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="h-4 w-32"/>
          <Skeleton className="h-9 w-full max-w-md"/>
        </div>
      ))}
    </div>
  )
}

// ---------- 表单状态 ----------

export type Values<F extends string> = Record<F, string>
export type Errors<F extends string> = Partial<Record<F, string>>

type ConfigFormOptions<T, F extends string> = {
  /** 用于 toast 与字段 id 前缀 */
  name: string
  load: () => Promise<T>
  save: (next: T, fields?: F[]) => Promise<T>
  toValues: (config: T) => Values<F>
  /** 把字段值合并回原配置（保留页面不认识的字段） */
  fromValues: (values: Values<F>, base: T) => T
  validate: (values: Values<F>) => Errors<F>
}

type LoadPhase = {phase: 'loading'} | {phase: 'error'; message: string} | {phase: 'ready'}

export type ConfigForm<T, F extends string> = {
  load: LoadPhase
  config: T | null
  values: Values<F> | null
  /** 只包含已改动字段或提交后的全部字段的校验信息 */
  visibleErrors: Errors<F>
  invalid: boolean
  dirty: boolean
  saving: boolean
  savedAt: number | null
  saveError: string | null
  fieldId: (field: F) => string
  setValue: (field: F, value: string) => void
  reset: (fields?: F[]) => void
  save: (fields?: F[]) => Promise<void>
  reload: () => void
}

/** 通用与模型提供商分区共用：加载、草稿、即时校验、保存与结果 */
export function useConfigForm<T, F extends string>(options: ConfigFormOptions<T, F>): ConfigForm<T, F> {
  const optionsRef = useRef(options)
  useEffect(() => {
    optionsRef.current = options
  })

  const [load, setLoad] = useState<LoadPhase>({phase: 'loading'})
  const [config, setConfig] = useState<T | null>(null)
  const [base, setBase] = useState<Values<F> | null>(null)
  const [values, setValues] = useState<Values<F> | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    optionsRef.current.load()
      .then((data) => {
        if (cancelled) return
        const v = optionsRef.current.toValues(data)
        setConfig(data)
        setBase(v)
        setValues(v)
        setLoad({phase: 'ready'})
      })
      .catch((err) => {
        if (!cancelled) setLoad({phase: 'error', message: errorMessage(err)})
      })
    return () => {
      cancelled = true
    }
  }, [attempt])

  const errors: Errors<F> = values ? options.validate(values) : {}
  const visibleErrors: Errors<F> = {}
  if (values && base) {
    for (const key of Object.keys(errors) as F[]) {
      if (submitted || values[key] !== base[key]) visibleErrors[key] = errors[key]
    }
  }

  const dirty = values != null && base != null && (Object.keys(values) as F[]).some((k) => values[k] !== base[k])
  const invalid = Object.keys(errors).length > 0
  const fieldId = useCallback((field: F) => `${options.name}-${field}`, [options.name])

  const setValue = useCallback((field: F, value: string) => {
    setValues((prev) => (prev ? {...prev, [field]: value} : prev))
    setSaveError(null)
  }, [])

  const reset = useCallback((fields?: F[]) => {
    setValues((prev) => fields && prev && base ? {...prev, ...Object.fromEntries(fields.map(f => [f, base[f]]))} : base)
    setSubmitted(false)
    setSaveError(null)
  }, [base])

  const save = useCallback(async (fields?: F[]) => {
    if (!values || !config || saving) return
    const {name, validate, fromValues} = optionsRef.current
    const currentErrors = validate(values)
    const first = Object.keys(currentErrors).find(key => !fields || fields.includes(key as F))
    if (first) {
      setSubmitted(true)
      document.getElementById(`${name}-${first}`)?.focus()
      return
    }
    setSaving(true)
    setSaveError(null)
    try {
      const next = await optionsRef.current.save(fromValues(values, config), fields)
      const v = optionsRef.current.toValues(next)
      setConfig(next)
      setBase(v)
      setValues(fields && base ? {...v, ...Object.fromEntries(
        (Object.keys(values) as F[]).filter(f => !fields.includes(f) && values[f] !== base[f]).map(f => [f, values[f]]))} : v)
      setSubmitted(false)
      setSavedAt(Date.now())
    } catch (err) {
      const message = errorMessage(err, '保存失败')
      setSaveError(message)
      toast.error(`保存失败：${message}`)
    } finally {
      setSaving(false)
    }
  }, [values, config, saving, base])

  const reload = useCallback(() => {
    setLoad({phase: 'loading'})
    setAttempt((n) => n + 1)
  }, [])

  return {load, config, values, visibleErrors, invalid, dirty, saving, savedAt, saveError, fieldId, setValue, reset, save, reload}
}

// ---------- 浮出保存条 ----------

type SettingsSaveBarProps = {
  /** 有当前分区的草稿时为 edit：撤销与保存；只有其他分区有草稿时为 jump：提示并跳转 */
  mode: 'edit' | 'jump'
  show: boolean
  /** 每次变化播放一次抖动，用于关闭或离开被拦时的提示 */
  shakeKey?: number
  saving?: boolean
  invalid?: boolean
  saveError?: string | null
  onReset?: () => void
  onSave?: () => void
  /** jump 模式下的文字与跳转动作 */
  jumpMessage?: string
  jumpLabel?: string
  onJump?: () => void
}

/**
 * 设置页唯一的保存入口：深色浮出条作用于当前分区的草稿。
 * 撤销只回到上次保存的值；保存失败、校验失败时在条内说明原因。
 */
export function SettingsSaveBar({mode, show, shakeKey, saving, invalid, saveError, onReset, onSave, jumpMessage, jumpLabel, onJump}: SettingsSaveBarProps) {
  const bar = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!shakeKey || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    bar.current?.animate?.([
      {transform: 'translateX(0)'}, {transform: 'translateX(-5px)'}, {transform: 'translateX(5px)'},
      {transform: 'translateX(-3px)'}, {transform: 'translateX(2px)'}, {transform: 'translateX(0)'},
    ], {duration: 420, easing: 'ease'})
  }, [shakeKey])
  const message = mode === 'jump' ? jumpMessage
    : saveError ? `保存失败：${saveError}`
    : invalid ? '有字段未通过校验'
    : saving ? '正在保存'
    : '有未保存的修改'
  return (
    <div
      ref={bar}
      role="region"
      aria-label="设置修改"
      className="settings-savebar absolute inset-x-6 bottom-4 z-10 flex items-center gap-2 rounded-[14px] bg-foreground py-2 pr-2 pl-3.5 text-background shadow-(--float-shadow)"
      data-show={show}
      inert={!show || undefined}
      aria-hidden={!show || undefined}
    >
      <AlertCircle className="size-4 shrink-0 opacity-80" aria-hidden/>
      <p role="status" aria-live="polite" className="min-w-0 flex-1 truncate text-meta">{message}</p>
      {mode === 'edit' ? (
        <>
          <Button type="button" variant="ghost" size="sm" className="text-background hover:bg-background/10 hover:text-background" onClick={() => onReset?.()} disabled={saving}>
            撤销
          </Button>
          <Button type="button" size="sm" className="bg-background text-foreground hover:bg-background/90" onClick={() => onSave?.()} disabled={saving || invalid}>
            {saving && <Loader2 className="animate-spin" aria-hidden/>}
            {saving ? '保存中' : '保存'}
          </Button>
        </>
      ) : (
        <Button type="button" variant="ghost" size="sm" className="text-background hover:bg-background/10 hover:text-background" onClick={() => onJump?.()}>
          {jumpLabel}
        </Button>
      )}
    </div>
  )
}

// ---------- 离开提示 ----------

/**
 * 有未保存修改时拦截离开：刷新或关闭标签页走浏览器原生提示；
 * 站内跳转拦截带 href 的链接和标了 data-navigate 的按钮（App Router 没有导航拦截接口）。
 */
export function useUnsavedGuard(dirty: boolean, onBlocked?: () => void) {
  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
    }
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0) return
      const target = (e.target as HTMLElement | null)?.closest('a[href], [data-navigate]')
      if (!target) return
      if (target instanceof HTMLAnchorElement) {
        if (target.target === '_blank' || e.metaKey || e.ctrlKey || e.shiftKey) return
        const url = new URL(target.href, window.location.href)
        if (url.origin === window.location.origin && url.pathname === window.location.pathname) return
      }
      e.preventDefault()
      e.stopPropagation()
      onBlocked?.()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    document.addEventListener('click', onClick, true)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      document.removeEventListener('click', onClick, true)
    }
  }, [dirty, onBlocked])
}

// ---------- 校验工具 ----------

export function checkInteger(value: string, min: number, max?: number): string | null {
  const v = value.trim()
  if (v === '') return '必填'
  if (!/^-?\d+$/.test(v)) return '请输入整数'
  const n = Number(v)
  if (n < min) return max != null ? `取值范围 ${min} 到 ${max}` : `不能小于 ${min}`
  if (max != null && n > max) return `取值范围 ${min} 到 ${max}`
  return null
}

export function checkHttpUrl(value: string): string | null {
  const v = value.trim()
  if (v === '') return '必填'
  try {
    const url = new URL(v)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '只支持 http:// 或 https:// 地址'
    return null
  } catch {
    return '不是有效的网址，需要完整写出 http:// 或 https:// 开头的地址'
  }
}

export function collect<F extends string>(checks: Partial<Record<F, string | null>>): Errors<F> {
  const out: Errors<F> = {}
  for (const [key, value] of Object.entries(checks) as [F, string | null][]) {
    if (value) out[key] = value
  }
  return out
}
