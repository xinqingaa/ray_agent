'use client'

import {useCallback, useEffect, useRef, useState, type ReactNode} from 'react'
import {AlertCircle, Check, Loader2, RotateCcw} from 'lucide-react'
import {toast} from 'sonner'
import {Button} from '@/components/ui/button'
import {Skeleton} from '@/components/ui/skeleton'
import {formatTime} from '@/components/run/format'

export function errorMessage(err: unknown, fallback = '请求失败'): string {
  if (err instanceof TypeError) return '无法连接 API 服务，请确认服务已启动'
  if (err instanceof Error && err.message) return err.message
  return fallback
}

// ---------- 分区外框 ----------

export function SectionHeader({id, title, description, action}: {id: string; title: string; description?: ReactNode; action?: ReactNode}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3 border-b pb-4">
      <div className="min-w-0 max-w-prose">
        <h2 id={id} className="text-base font-semibold">{title}</h2>
        {description ? <p className="mt-1 text-meta text-muted-foreground">{description}</p> : null}
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

// ---------- 字段 ----------

type FormFieldProps = {
  id: string
  label: string
  hint?: ReactNode
  error?: string | null
  children: (aria: {id: string; 'aria-describedby': string | undefined; 'aria-invalid': boolean | undefined}) => ReactNode
}

/** 标签、说明与校验信息；控件由 children 渲染并接收关联属性 */
export function FormField({id, label, hint, error, children}: FormFieldProps) {
  const hintId = hint ? `${id}-hint` : null
  const errorId = error ? `${id}-error` : null
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined
  return (
    <div className="grid gap-x-8 gap-y-1.5 py-4 @xl/form:grid-cols-[minmax(0,15rem)_minmax(0,28rem)]">
      <div className="min-w-0">
        <label htmlFor={id} className="text-sm font-medium">{label}</label>
        {hint && <p id={hintId ?? undefined} className="mt-0.5 text-xs leading-5 text-muted-foreground">{hint}</p>}
      </div>
      <div className="min-w-0">
        {children({id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined})}
        {error && (
          <p id={errorId ?? undefined} className="mt-1.5 flex items-center gap-1 text-xs text-destructive">
            <AlertCircle className="size-3.5 shrink-0" aria-hidden/>
            {error}
          </p>
        )}
      </div>
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

// ---------- 保存栏 ----------

type SaveBarProps = {
  dirty: boolean
  saving: boolean
  invalid: boolean
  savedAt: number | null
  saveError: string | null
  onReset: () => void
  label?: string
}

/** 分区底部的保存栏；表单以 submit 触发保存，回车即可提交 */
export function SaveBar({dirty, saving, invalid, savedAt, saveError, onReset, label = "保存"}: SaveBarProps) {
  let status: ReactNode = null
  if (saving) status = <span className="text-muted-foreground">正在保存</span>
  else if (saveError) status = <span className="text-destructive">保存失败：{saveError}</span>
  else if (dirty && invalid) status = <span className="text-destructive">有字段未通过校验</span>
  else if (dirty) status = <span className="text-state-waiting">有未保存的修改</span>
  else if (savedAt != null) {
    status = (
      <span className="inline-flex items-center gap-1 text-state-success">
        <Check className="size-3.5" aria-hidden/>
        已于 <span className="tabular-nums">{formatTime(savedAt)}</span> 保存
      </span>
    )
  }

  return (
    <div className="sticky bottom-0 -mx-1 mt-2 flex flex-wrap items-center gap-3 border-t bg-background/95 px-1 py-3 backdrop-blur">
      <p className="min-w-0 flex-1 text-meta" aria-live="polite">{status}</p>
      <Button type="button" variant="ghost" size="sm" onClick={onReset} disabled={!dirty || saving}>
        撤销修改
      </Button>
      <Button type="submit" size="sm" disabled={!dirty || saving}>
        {saving && <Loader2 className="animate-spin" aria-hidden/>}
        {saving ? '保存中' : label}
      </Button>
    </div>
  )
}

// ---------- 离开提示 ----------

/**
 * 有未保存修改时拦截离开：刷新或关闭标签页走浏览器原生提示；
 * 站内跳转拦截带 href 的链接和标了 data-navigate 的按钮（App Router 没有导航拦截接口）。
 */
export function useUnsavedGuard(dirty: boolean, message = '有未保存的修改，离开后会丢失。确定离开吗？') {
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
      if (!window.confirm(message)) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    document.addEventListener('click', onClick, true)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      document.removeEventListener('click', onClick, true)
    }
  }, [dirty, message])
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
