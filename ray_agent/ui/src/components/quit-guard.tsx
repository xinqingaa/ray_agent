import {useEffect, useState} from 'react'
import {Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle} from '@/components/ui/dialog'
import {Button} from '@/components/ui/button'
import {sessionApi} from '@/lib/api/session'
import type {SessionStatus} from '@/lib/api/types'
import {confirmQuit, isDesktop, onQuitRequested} from '@/lib/platform'

const ACTIVE: ReadonlySet<SessionStatus> = new Set(['pending', 'running', 'waiting'])

/** 宿主请求退出时检查活动任务；没有任务直接退出，有任务由用户确认后再停止。读不到任务列表时也请用户确认。 */
export function QuitGuard() {
  const [active, setActive] = useState<number | null>(null)
  const [open, setOpen] = useState(false)
  const [quitting, setQuitting] = useState(false)

  useEffect(() => {
    if (!isDesktop()) return
    let disposed = false
    const unlisten = onQuitRequested(() => {
      void sessionApi.getSessions().then(
        page => page.sessions.filter(session => ACTIVE.has(session.status)).length,
        () => null,
      ).then(count => {
        if (disposed) return
        if (count === 0) {void confirmQuit(); return}
        setActive(count)
        setOpen(true)
      })
    })
    return () => {disposed = true; void unlisten.then(stop => stop())}
  }, [])

  const quit = () => {
    setQuitting(true)
    void confirmQuit()
  }

  return (
    <Dialog open={open} onOpenChange={next => {if (!quitting) setOpen(next)}}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">退出 RayAgent？</DialogTitle>
          <DialogDescription className="text-sm leading-relaxed text-muted-foreground">
            {active === null
              ? '无法确认是否有任务正在进行。退出会停止仍在进行的任务，它们会记为中断。'
              : `有 ${active} 个任务正在进行。退出会停止这些任务，它们会记为中断。`}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" autoFocus onClick={() => setOpen(false)} disabled={quitting}>取消</Button>
          <Button variant="destructive" onClick={quit} disabled={quitting}>{quitting ? '正在退出' : '停止任务并退出'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
