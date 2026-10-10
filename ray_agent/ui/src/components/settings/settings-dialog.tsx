'use client'

import {useState} from 'react'
import {useRouter} from 'next/navigation'
import {Dialog, DialogContent, DialogTitle} from '@/components/ui/dialog'
import {SettingsView} from './settings-view'

/** 覆盖应用导航，保留下面的会话与草稿；所有关闭入口共用离开保护。 */
export function SettingsDialog({open, onOpenChange}: {open: boolean; onOpenChange: (open: boolean) => void}) {
  const [dirty, setDirty] = useState(false)
  const close = () => {
    if (dirty && !window.confirm('有未保存的修改，关闭后会丢失。确定关闭吗？')) return false
    setDirty(false)
    onOpenChange(false)
    return true
  }

  return (
    <Dialog open={open} onOpenChange={next => {if (!next) close()}}>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        className="flex h-[min(52rem,calc(100dvh-3rem))] max-h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] max-w-none flex-col gap-0 overflow-hidden rounded-xl p-0 shadow-2xl sm:w-[calc(100%-3rem)] sm:max-w-6xl"
        onPointerDownOutside={event => event.preventDefault()}
        onInteractOutside={event => event.preventDefault()}
      >
        <DialogTitle className="sr-only">设置</DialogTitle>
        <SettingsView onNavigate={close} onClose={close} onDirtyChange={setDirty}/>
      </DialogContent>
    </Dialog>
  )
}

/** 直接访问设置地址时提供完整页面，不呈现会话侧栏。 */
export function SettingsPageView() {
  const router = useRouter()
  const [dirty, setDirty] = useState(false)
  return <SettingsView onDirtyChange={setDirty} onClose={() => {
    if (dirty && !window.confirm('有未保存的修改，关闭后会丢失。确定关闭吗？')) return false
    router.push('/')
  }}/>
}
