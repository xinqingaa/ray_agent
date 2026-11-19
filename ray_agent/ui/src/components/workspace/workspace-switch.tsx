export function WorkspaceSwitch({label, text = label, alternate, checked, disabled, pending, onChange}: {
  label: string
  text?: string
  alternate?: string
  checked: boolean
  disabled?: boolean
  pending?: boolean
  onChange: (checked: boolean) => void
}) {
  return <button type="button" className="workspace-inline-switch" role="switch" aria-label={label}
    aria-checked={checked} aria-disabled={disabled || pending || undefined} aria-busy={pending || undefined}
    onClick={() => {if (!disabled && !pending) onChange(!checked)}}>
    <span className="workspace-switch-label">
      {alternate && <span className="workspace-switch-reserve" aria-hidden>{alternate}</span>}
      <span>{text}</span>
    </span>
    <span className="workspace-switch-track" aria-hidden><span/></span>
  </button>
}
