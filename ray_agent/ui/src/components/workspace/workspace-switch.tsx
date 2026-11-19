import {cn} from '@/lib/utils'

export function WorkspaceSwitch({label, text = label, alternate, className, descriptionId, checked, disabled, pending, onChange}: {
  label: string
  text?: string
  alternate?: string
  className?: string
  descriptionId?: string
  checked: boolean
  disabled?: boolean
  pending?: boolean
  onChange: (checked: boolean) => void
}) {
  return <button type="button" className={cn('workspace-inline-switch', className)} role="switch" aria-label={label} aria-describedby={descriptionId}
    aria-checked={checked} aria-disabled={disabled || pending || undefined} aria-busy={pending || undefined}
    onClick={() => {if (!disabled && !pending) onChange(!checked)}}>
    <span className="workspace-switch-label">
      {alternate && <span className="workspace-switch-reserve" aria-hidden>{alternate}</span>}
      <span>{text}</span>
    </span>
    <span className="workspace-switch-track" aria-hidden><span/></span>
  </button>
}
