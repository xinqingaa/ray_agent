import {useRef, type KeyboardEvent, type ReactNode} from 'react'
import {AlertCircle} from '@/components/ui/icons'
import {SegmentThumb, useSegmentThumb} from '@/components/ui/segment-thumb'
import {cn} from '@/lib/utils'
import './settings-row.css'

/**
 * 设置分区中的一行：标题与说明在左，控件在右。行间的细线由外层的 divide-y 提供。
 * `htmlFor` 把标题关联到控件；`id` 作为整行的标识，控件可用 `${id}-title` 作为 aria-labelledby。
 */
export function SettingsRow({title, description, control, htmlFor, id, error, className}: {
  title: ReactNode
  description?: ReactNode
  control?: ReactNode
  htmlFor?: string
  id?: string
  error?: ReactNode
  className?: string
}) {
  const titleId = id ? `${id}-title` : undefined
  return (
    <div id={id} className={cn('flex flex-wrap items-center gap-x-6 gap-y-2 py-3.5', className)}>
      <div className="min-w-0 flex-1 basis-64">
        {htmlFor
          ? <label id={titleId} htmlFor={htmlFor} className="block text-sm font-medium">{title}</label>
          : <div id={titleId} className="text-sm font-medium">{title}</div>}
        {description && <div className="mt-0.5 text-meta leading-5 text-muted-foreground">{description}</div>}
        {error && <div role="alert" className="mt-1.5 flex items-start gap-1 text-meta text-destructive">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden/>
          <span className="min-w-0 break-words">{error}</span>
        </div>}
      </div>
      {control && <div className="flex min-w-0 max-w-full shrink-0 flex-wrap items-center justify-end gap-2">{control}</div>}
    </div>
  )
}

/**
 * 分段控件（单选）：用于主题、字号、语音、工具策略等固定取值。`value` 为 null 时没有选中项。
 * `inherited` 表示当前取值来自上级设置，选中态弱化，提示“未单独设置”。
 */
export function SettingsSegment<T extends string>({label, value, options, onChange, disabled, inherited}: {
  label: string
  value: T | null
  options: readonly {value: T; label: string}[]
  onChange: (value: T) => void
  disabled?: boolean
  inherited?: boolean
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const rootRef = useRef<HTMLDivElement>(null)
  const thumb = useSegmentThumb(rootRef, value, options.map(option => option.value).join('\u0000'))
  const focusable = Math.max(0, options.findIndex(option => option.value === value))
  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']
    if (!keys.includes(event.key)) return
    event.preventDefault()
    const last = options.length - 1
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? last
      : ['ArrowLeft', 'ArrowUp'].includes(event.key) ? (index === 0 ? last : index - 1) : (index === last ? 0 : index + 1)
    onChange(options[next].value)
    refs.current[next]?.focus()
  }
  return (
    <div ref={rootRef} role="radiogroup" aria-label={label} className="relative isolate inline-flex max-w-full flex-wrap gap-0.5 rounded-[10px] bg-muted p-0.5">
      <SegmentThumb thumb={thumb} className={cn('rounded-[8px]', inherited ? 'bg-background/60' : 'bg-card shadow-(--paper-shadow)')}/>
      {options.map((option, index) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            ref={node => {refs.current[index] = node}}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={index === focusable ? 0 : -1}
            disabled={disabled}
            onClick={() => {if (!selected) onChange(option.value)}}
            onKeyDown={event => move(event, index)}
            className={cn(
              'relative inline-flex min-h-7 items-center justify-center gap-1.5 whitespace-nowrap rounded-[8px] px-2.5 text-meta outline-none transition-colors duration-(--motion-fast) ease-(--motion-ease)',
              'focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
              selected
                ? inherited ? 'text-muted-foreground' : 'font-medium text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

/**
 * 卡片式列表项（模型提供商、MCP 服务器、远程 Agent）：左侧图标块，中间名称与状态，右侧操作。
 */
export function SettingsCard({mark, title, detail, actions, children, className}: {
  mark: ReactNode
  title: ReactNode
  detail?: ReactNode
  actions?: ReactNode
  children?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex items-start gap-3.5 rounded-[13px] bg-muted px-3.5 py-3', className)}>
      <span className="grid size-[34px] shrink-0 place-items-center rounded-[10px] bg-card text-muted-foreground shadow-(--paper-shadow)" aria-hidden>{mark}</span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">{title}</div>
        {detail && <div className="mt-0.5 min-w-0 text-meta leading-5 text-muted-foreground">{detail}</div>}
        {children}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1 self-center">{actions}</div>}
    </div>
  )
}
