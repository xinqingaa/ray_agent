import {Button} from '@/components/ui/button'
import {Loader2} from '@/components/ui/icons'
import {Switch} from '@/components/ui/switch'

export function PreferenceSwitch({id, checked, pending = false, loading = false, onChange}: {
  id: string
  checked: boolean | null
  pending?: boolean
  loading?: boolean
  onChange: (value: boolean) => void
}) {
  return <span className="inline-flex items-center gap-2">
    <span className="grid size-3.5 shrink-0 place-items-center text-muted-foreground">
      {pending && <Loader2 className="size-3.5 motion-safe:animate-spin" aria-hidden/>}
    </span>
    {checked === null
      ? <span className="h-[1.15rem] w-8 shrink-0 rounded-full bg-muted" aria-hidden={!loading}
        role={loading ? 'status' : undefined} aria-label={loading ? '正在读取' : undefined}/>
      : <Switch id={id + '-switch'} aria-labelledby={id + '-title'} checked={checked}
        disabled={pending} aria-busy={pending || undefined} onCheckedChange={onChange}/>}
  </span>
}

export function PreferenceReadError({message, onRetry}: {message: string; onRetry: () => void}) {
  return <>{message} <Button type="button" size="xs" variant="ghost" className="ml-1" onClick={onRetry}>重试</Button></>
}
