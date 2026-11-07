import {Fragment, useCallback, useEffect, useRef, useState, type ReactNode} from 'react'
import {RotateCw} from 'lucide-react'
import {BrandMark} from '@/components/brand-mark'
import {Button} from '@/components/ui/button'
import {setCoreConnection} from '@/lib/core-client'
import {isDesktop, readCoreConnection, restartCore, type HostConnection} from '@/lib/platform'

const STARTING_POLL_MS = 250
const READY_POLL_MS = 2000
/** 启动通常很快，短于这段时间不显示启动画面，避免闪烁 */
const STARTING_NOTICE_DELAY_MS = 400

const TITLES: Record<Exclude<HostConnection['state'], 'starting'>, string> = {
  ready: '核心连接不完整',
  failed: '核心未能启动',
  incompatible: '核心版本与应用不匹配',
  exited: '核心已停止运行',
  stopped: '核心已停止',
}

function readyKey(connection: HostConnection | null) {
  return connection?.state === 'ready' && connection.base_url && connection.token ? connection.token : null
}

/** 核心就绪前不渲染应用；核心退出或重启后换用新连接重新挂载，草稿保存在会话存储中不受影响。 */
export function CoreGate({children}: {children: ReactNode}) {
  const desktop = isDesktop()
  const [connection, setConnection] = useState<HostConnection | null>(null)
  const [showStarting, setShowStarting] = useState(false)
  const [restarting, setRestarting] = useState(false)
  const timer = useRef<number | undefined>(undefined)

  const poll = useCallback(async () => {
    window.clearTimeout(timer.current)
    let next: HostConnection
    try {next = await readCoreConnection()}
    catch (error) {
      next = {state: 'failed', startup_ms: null, base_url: null, token: null, detail: null, logs: [],
        error: {code: 'unavailable', message: error instanceof Error ? error.message : '无法读取核心状态', retryable: true, retry_after_ms: null, resource_version: null, details: {}}}
    }
    setCoreConnection(next.state === 'ready' && next.base_url && next.token ? {baseUrl: next.base_url, token: next.token} : null)
    setConnection(current => readyKey(current) !== null && readyKey(current) === readyKey(next) ? current : next)
    if (next.state === 'starting' || next.state === 'ready') {
      timer.current = window.setTimeout(() => void poll(), next.state === 'starting' ? STARTING_POLL_MS : READY_POLL_MS)
    }
  }, [])

  useEffect(() => {
    if (!desktop) return
    void poll()
    const notice = window.setTimeout(() => setShowStarting(true), STARTING_NOTICE_DELAY_MS)
    return () => {window.clearTimeout(timer.current); window.clearTimeout(notice)}
  }, [desktop, poll])

  const restart = async () => {
    setRestarting(true)
    try {await restartCore()} catch {/* 新状态由下一次读取给出 */}
    finally {setRestarting(false)}
    void poll()
  }

  if (!desktop) {
    return <GateFrame title="请从 RayAgent 应用打开">
      <p className="text-sm text-muted-foreground">界面需要桌面宿主提供的核心连接，单独在浏览器中打开时无法使用。</p>
    </GateFrame>
  }

  const key = readyKey(connection)
  if (key) return <Fragment key={key}>{children}</Fragment>

  if (!connection || connection.state === 'starting') {
    return showStarting ? <GateFrame title="正在启动核心" busy/> : null
  }

  const {state, error, detail, logs} = connection
  return (
    <GateFrame title={TITLES[state]}>
      <p className="text-sm text-muted-foreground">
        {error?.message ?? (state === 'exited' ? '核心进程意外退出，正在进行的任务已中断。' : '核心当前不可用。')}
      </p>
      {detail && <p className="text-meta text-faint break-words">{detail}</p>}
      {logs.length > 0 && (
        <details className="text-meta">
          <summary className="cursor-pointer text-muted-foreground">最近的核心日志</summary>
          <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-muted p-3 font-mono text-xs leading-5 whitespace-pre-wrap break-all">{logs.join('\n')}</pre>
        </details>
      )}
      {state !== 'incompatible' && (
        <Button type="button" onClick={() => void restart()} disabled={restarting}>
          <RotateCw aria-hidden className={restarting ? 'animate-spin motion-reduce:animate-none' : undefined}/>
          {restarting ? '正在重新启动' : '重新启动核心'}
        </Button>
      )}
    </GateFrame>
  )
}

function GateFrame({title, busy, children}: {title: string; busy?: boolean; children?: ReactNode}) {
  return (
    <main className="flex h-screen items-center justify-center overflow-y-auto px-6 py-10">
      <section aria-busy={busy || undefined} className="w-full max-w-(--reading-column) space-y-4">
        <div className="flex items-center gap-3">
          <BrandMark className="size-7"/>
          <h1 role={busy ? 'status' : undefined} className="text-lg font-semibold">{title}</h1>
        </div>
        {children}
      </section>
    </main>
  )
}
