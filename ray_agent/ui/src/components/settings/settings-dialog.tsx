import {useCallback, useState} from 'react'
import {useRouter} from '@/lib/navigation'
import {Dialog, DialogContent, DialogTitle} from '@/components/ui/dialog'
import {SettingsView} from './settings-view'

function useSettingsClose(onClose: () => void) {
  const [dirty, setDirty] = useState(false)
  const [closeBlocked, setCloseBlocked] = useState(false)
  const close = () => {
    if (dirty) {
      setCloseBlocked(true)
      return false
    }
    onClose()
    return true
  }
  const onDirtyChange = useCallback((next: boolean) => {
    setDirty(next)
    if (!next) setCloseBlocked(false)
  }, [])
  const onLeaveBlocked = useCallback(() => setCloseBlocked(true), [])
  return {close, closeBlocked, onDirtyChange, onLeaveBlocked}
}

/** 覆盖应用导航，保留下面的会话与草稿；所有关闭入口共用离开保护。 */
export function SettingsDialog({open, onOpenChange}: {open: boolean; onOpenChange: (open: boolean) => void}) {
  const {close, ...guard} = useSettingsClose(() => onOpenChange(false))
  return (
    <Dialog open={open} onOpenChange={next => {if (!next) close()}}>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        className="flex h-[min(640px,calc(100dvh-1rem))] w-[calc(100%-1rem)] max-w-none flex-col gap-0 overflow-hidden rounded-[22px] border-0 p-0 shadow-(--float-shadow) sm:h-[min(640px,calc(100dvh-3rem))] sm:w-[calc(100%-3rem)] sm:max-w-[940px]"
        onEscapeKeyDown={event => {
          if (document.activeElement?.hasAttribute('data-settings-escape')) event.preventDefault()
        }}
        onPointerDownOutside={event => event.preventDefault()}
        onInteractOutside={event => event.preventDefault()}
      >
        <DialogTitle className="sr-only">设置</DialogTitle>
        <SettingsView onNavigate={close} onClose={close} {...guard}/>
      </DialogContent>
    </Dialog>
  )
}

/** 直接访问设置地址时提供完整页面，不呈现会话侧栏。 */
export function SettingsPageView() {
  const router = useRouter()
  const {close, ...guard} = useSettingsClose(() => router.push('/'))
  return <SettingsView onClose={close} {...guard}/>
}
