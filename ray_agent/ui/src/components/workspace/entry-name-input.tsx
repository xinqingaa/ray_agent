import {useEffect, useRef} from 'react'
import {Input} from '@/components/ui/input'
import {useImeComposition} from '@/lib/ime'
import {renameSelection} from '@/lib/workspace-entries'
import {cn} from '@/lib/utils'

/**
 * 文件夹树里就地输入名称（重命名或新建文件夹）。
 * Enter 提交，Escape 取消；失去焦点时由调用方决定提交或取消。错误说明留在输入框下方，不关闭编辑。
 */
export function EntryNameInput({label, value, error, selectBase, busy, onChange, onCommit, onCancel, onBlur}: {
  label: string
  value: string
  error?: string
  /** 重命名：默认选中主名，扩展名留在选区之外 */
  selectBase?: boolean
  busy?: boolean
  onChange: (value: string) => void
  onCommit: () => void
  onCancel: () => void
  onBlur: () => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const ime = useImeComposition()
  useEffect(() => {
    const node = input.current
    if (!node) return
    node.focus()
    const [start, end] = selectBase ? renameSelection(value) : [value.length, value.length]
    node.setSelectionRange(start, end)
    // 只在出现时聚焦一次；之后的输入由用户控制
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- 挂载时聚焦

  return <div className="min-w-0 flex-1 space-y-1 py-0.5">
    <Input ref={input} aria-label={label} aria-invalid={error ? true : undefined} value={value} disabled={busy}
      className={cn('h-7 px-2 py-0 text-sm', error && 'border-destructive')}
      onChange={event => onChange(event.target.value)}
      onBlur={onBlur}
      onCompositionStart={ime.onCompositionStart}
      onCompositionEnd={ime.onCompositionEnd}
      onKeyDown={event => {
        if (ime.isComposingKeyDown(event)) return
        if (event.key === 'Enter') {event.preventDefault(); event.stopPropagation(); onCommit()}
        else if (event.key === 'Escape') {event.preventDefault(); event.stopPropagation(); onCancel()}
      }}/>
    {error && <p role="alert" className="text-xs leading-4 text-state-failed">{error}</p>}
  </div>
}
