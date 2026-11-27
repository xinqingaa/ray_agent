import {useEffect, useRef, useState, type MouseEvent} from 'react'
import {Navigate} from 'react-router'
import {EvaluationDetail} from '@/components/evaluation/evaluation-detail'
import {EvaluationStartDialog} from '@/components/evaluation/evaluation-start'
import {LoadError} from '@/components/settings/form'
import {TopbarActions} from '@/components/sidebar-chrome'
import {TaskInspector, TaskLayout, useTaskInspector} from '@/components/task-layout'
import {Button} from '@/components/ui/button'
import {AlertCircle, ArrowLeft, Check, ChevronRight, Clock3, Loader2, Stop} from '@/components/ui/icons'
import {Select} from '@/components/ui/select'
import {useDeveloperMode} from '@/hooks/use-developer-mode'
import {evaluationApi, type EvaluationBatch, type EvaluationCaseId, type EvaluationOverview, type EvaluationStart} from '@/lib/api/evaluation'
import {caseSummary, elapsed, evaluationError, evaluationStates, timingChange} from '@/lib/evaluation-summary'
import {Link} from '@/lib/navigation'
import {cn} from '@/lib/utils'

const batchDate = new Intl.DateTimeFormat('zh-CN', {
  month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
})

const shortBatchDate = new Intl.DateTimeFormat('zh-CN', {
  month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
})

function dateLabel(batch: EvaluationBatch) {
  return batchDate.format(new Date(batch.created_at))
}

function withBatch(overview: EvaluationOverview, batch: EvaluationBatch) {
  const exists = overview.batches.some(item => item.id === batch.id)
  return {
    ...overview,
    batches: exists ? overview.batches.map(item => item.id === batch.id ? batch : item) : [batch, ...overview.batches],
  }
}

function Outcome({status}: {status: ReturnType<typeof caseSummary>}) {
  const Icon = status.tone === 'failed' ? AlertCircle : status.tone === 'passed' ? Check : Clock3
  return <span className={cn('inline-flex items-center gap-1.5 text-meta',
    status.tone === 'failed' ? 'text-state-failed' : status.tone === 'passed' ? 'text-state-success' : 'text-muted-foreground')}>
    <Icon className="size-3.5 shrink-0" aria-hidden/>{status.label}
  </span>
}

const wideColumn = 'hidden @xl/evaluation:block'
const numberColumn = 'text-right tabular-nums'

function CasesTable({batch, overview, selected, onSelect}: {
  batch: EvaluationBatch
  overview: EvaluationOverview
  selected: EvaluationCaseId | null
  onSelect: (id: EvaluationCaseId, trigger: HTMLButtonElement) => void
}) {
  const columns = batch.baseline
    ? '@xl/evaluation:grid-cols-[minmax(0,1.65fr)_minmax(7rem,0.9fr)_6rem_6rem_5rem_1rem]'
    : '@xl/evaluation:grid-cols-[minmax(0,1.8fr)_minmax(7rem,0.85fr)_6rem_1rem]'
  const grid = cn('grid grid-cols-[minmax(0,1fr)_auto_1rem] items-center gap-2', columns)
  const choose = (event: MouseEvent, id: EvaluationCaseId) => {
    const trigger = event.currentTarget.querySelector('button')
    if (trigger) onSelect(id, trigger)
  }

  return <div className="border-t border-border/75" role="table" aria-label="评测用例对比">
    <div role="row" className={cn(grid, 'px-2.5 py-2 text-meta text-muted-foreground')}>
      <span role="columnheader">用例</span>
      <span role="columnheader" className={wideColumn}>交付结果</span>
      {batch.baseline && <span role="columnheader" className={cn(wideColumn, numberColumn)}>基准用时</span>}
      <span role="columnheader" className={cn(wideColumn, numberColumn)}>当前用时</span>
      <span role="columnheader" className={cn(numberColumn, !batch.baseline && '@xl/evaluation:hidden')}>
        {batch.baseline ? '耗时变化' : '用时'}
      </span>
      <span aria-hidden/>
    </div>
    <div role="rowgroup" className="divide-y divide-border/55 border-y border-border/60">
      {batch.cases.map(id => {
        const entry = overview.catalog.cases.find(item => item.id === id)
        const status = caseSummary(batch, id)
        const active = selected === id
        const base = status.baseTime == null ? '—' : elapsed(status.baseTime, 1)
        const current = status.currentTime == null ? '—' : elapsed(status.currentTime, 1)
        return <div key={id} role="row" onClick={event => choose(event, id)} className={cn(grid,
          'relative min-h-15 cursor-pointer rounded-md px-2.5 py-2 hover:bg-muted/65',
          active && 'bg-signal-soft/70 hover:bg-signal-soft/70')}>
          <div role="cell" className="min-w-0">
            <button type="button" aria-expanded={active} aria-controls={active ? 'evaluation-case-detail' : undefined}
              className={cn('block max-w-full rounded-sm text-left text-sm font-medium wrap-anywhere outline-none focus-visible:ring-2 focus-visible:ring-ring', active && 'text-signal')}>
              {entry?.title ?? id}
            </button>
            <div className="mt-0.5 @xl/evaluation:hidden">
              <Outcome status={status}/>
              {batch.baseline && (status.baseTime != null || status.currentTime != null) &&
                <p className="mt-0.5 text-meta tabular-nums text-muted-foreground">{base} → {current}</p>}
            </div>
            {status.reason && <p className="mt-0.5 line-clamp-2 text-meta wrap-anywhere text-muted-foreground">{status.reason}</p>}
          </div>
          <span role="cell" className={wideColumn}><Outcome status={status}/></span>
          {batch.baseline && <span role="cell" className={cn(wideColumn, numberColumn, 'text-meta text-muted-foreground')}>{base}</span>}
          <span role="cell" className={cn(wideColumn, numberColumn, 'text-meta')}>{current}</span>
          <span role="cell" className={cn(numberColumn, 'whitespace-nowrap text-meta text-muted-foreground', !batch.baseline && '@xl/evaluation:hidden')}>
            {batch.baseline ? timingChange(status.delta) : current}
          </span>
          <ChevronRight className="size-3.5 text-faint" aria-hidden/>
        </div>
      })}
    </div>
  </div>
}

function EvaluationWorkbench() {
  const [overview, setOverview] = useState<EvaluationOverview | null>(null)
  const [batchId, setBatchId] = useState('')
  const [caseId, setCaseId] = useState<EvaluationCaseId | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const [stopping, setStopping] = useState(false)
  const inspector = useTaskInspector(false)
  const rowTrigger = useRef<HTMLButtonElement | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    let active = true
    evaluationApi.overview().then(value => {
      if (!active) return
      setOverview(value)
      setBatchId(previous => value.batches.some(item => item.id === previous) ? previous
        : (value.batches.find(item => item.state === 'running') ?? value.batches[0])?.id ?? '')
      setError(null)
    }).catch(reason => {if (active) setError(evaluationError(reason))})
    return () => {active = false}
  }, [retry])

  const running = overview?.batches.find(item => item.state === 'running')
  const runningId = running?.id
  useEffect(() => {
    if (!runningId) return
    let active = true
    let timer: number
    const refresh = async () => {
      try {
        const next = await evaluationApi.batch(runningId)
        if (!active) return
        setOverview(previous => previous && withBatch(previous, next))
        setError(null)
        if (next.state === 'running') timer = window.setTimeout(refresh, 2000)
      } catch (reason) {
        if (!active) return
        setError(evaluationError(reason))
        timer = window.setTimeout(refresh, 4000)
      }
    }
    timer = window.setTimeout(refresh, 850)
    return () => {active = false; window.clearTimeout(timer)}
  }, [runningId])

  function chooseBatch(id: string) {
    setBatchId(id)
    setCaseId(null)
    inspector.setOpen(false)
    rowTrigger.current = null
  }

  function showCase(id: EvaluationCaseId, trigger: HTMLButtonElement) {
    rowTrigger.current = trigger
    trigger.focus({preventScroll: true})
    setCaseId(id)
    inspector.setOpen(true)
  }

  function closeInspector() {
    inspector.setOpen(false)
    rowTrigger.current?.focus({preventScroll: true})
  }

  async function start(request: EvaluationStart) {
    const next = await evaluationApi.start(request)
    setOverview(previous => previous && withBatch(previous, next))
    setError(null)
    chooseBatch(next.id)
  }

  async function stop(id: string) {
    setStopping(true)
    try {
      const next = await evaluationApi.cancel(id)
      setOverview(previous => previous && withBatch(previous, next))
      setError(null)
    } catch (reason) {
      setError(evaluationError(reason))
    } finally {
      setStopping(false)
    }
  }

  const batch = overview?.batches.find(item => item.id === batchId)
  const selectedCase = overview?.catalog.cases.find(item => item.id === caseId)
  const details = batch && caseId && batch.cases.includes(caseId)
  const recorded = batch?.results?.length ?? 0

  return <>
    <TopbarActions>
      <Button asChild size="sm" variant="ghost" className="max-[540px]:px-1.5"><Link href="/settings" aria-label="返回设置"><ArrowLeft aria-hidden/><span className="max-[540px]:hidden">返回设置</span></Link></Button>
      {overview && overview.batches.length > 0 && <Select label="评测批次" value={batchId} onChange={chooseBatch}
        options={overview.batches.map(item => ({id: item.id, label: `${dateLabel(item)} · ${item.model} · ${evaluationStates[item.state]}`}))}
        displayValue={batch && shortBatchDate.format(new Date(batch.created_at))} className="mt-0 w-36 max-[540px]:w-24 border-transparent bg-transparent hover:bg-muted/70"/>}
      {overview && <EvaluationStartDialog overview={overview} running={Boolean(running)} dateLabel={dateLabel} onStart={start} focusResults={() => heading.current?.focus({preventScroll: true})}/>}
    </TopbarActions>
    <TaskLayout inspector={<TaskInspector state={inspector} label="用例详情" triggerRef={rowTrigger}>
      {details && <div id="evaluation-case-detail" className="contents">
        <EvaluationDetail key={`${batch.id}:${caseId}`} batch={batch} caseId={caseId} title={selectedCase?.title ?? caseId}
          criteria={selectedCase?.criteria} onClose={closeInspector}/>
      </div>}
    </TaskInspector>}>
      <main aria-labelledby="evaluation-main-title" className="min-h-0 flex-1 overflow-y-auto overscroll-contain @container/evaluation">
        <div className="mx-auto max-w-5xl px-4 py-5 sm:px-7 sm:py-6">
          {error && <div className="mb-3"><LoadError message={error} onRetry={() => setRetry(value => value + 1)}/></div>}
          {running && running.id !== batchId && <div className="mb-4 flex items-center gap-2 text-meta text-muted-foreground">
            <Loader2 className="size-3.5 motion-safe:animate-spin" aria-hidden/>另一批评测正在运行
            <Button size="xs" variant="ghost" onClick={() => chooseBatch(running.id)}>查看</Button>
          </div>}
          <header className="mb-4">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <h1 ref={heading} id="evaluation-main-title" className="text-lg font-semibold tracking-tight" tabIndex={-1}>评测结果</h1>
              {batch && <span className={cn('text-meta', batch.state === 'failed' || batch.state === 'interrupted' ? 'text-state-failed' : 'text-muted-foreground')}>
                {evaluationStates[batch.state]}
              </span>}
            </div>
            {batch && <p className="mt-1.5 flex flex-wrap gap-x-2 gap-y-0.5 text-meta text-muted-foreground">
              <span>{batch.baseline ? `${batch.baseline} → ${batch.candidate}` : batch.candidate}</span>
              <span aria-hidden>·</span><span>{batch.model}</span>
              <span aria-hidden>·</span><span>每项 {batch.repeats} 次</span>
            </p>}
          </header>
          {batch?.state === 'running' && <div className="mb-4 flex min-h-9 flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/55 px-2.5 py-1">
            <div role="status" className="flex min-w-0 items-center gap-2 text-meta text-muted-foreground">
              <Loader2 className="size-3.5 shrink-0 text-signal motion-safe:animate-spin" aria-hidden/>
              <span>{batch.current}</span>
              <span className="shrink-0 tabular-nums">{recorded}/{batch.cases.length * batch.repeats * (batch.baseline ? 2 : 1)} 次已记录</span>
            </div>
            <Button size="xs" variant="ghost" disabled={stopping} onClick={() => void stop(batch.id)}><Stop aria-hidden/>停止评测</Button>
          </div>}
          {batch?.error && <p role="alert" className="mb-3 text-sm text-state-failed">{batch.error}</p>}
          {batch && overview && <>
            <CasesTable batch={batch} overview={overview} selected={inspector.open ? caseId : null} onSelect={showCase}/>
            {batch.repeats > 1 && <p className="mt-2 text-meta text-muted-foreground">用时显示已测运行的中位数，两版数据齐全时给出变化。</p>}
          </>}
          {!overview && !error && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden/>正在读取评测
          </p>}
          {overview && !batch && <p className="text-sm text-muted-foreground">还没有评测记录。新建评测后，可以在这里对比交付和耗时。</p>}
        </div>
      </main>
    </TaskLayout>
  </>
}

export function EvaluationPage() {
  const {enabled} = useDeveloperMode()
  return enabled ? <EvaluationWorkbench/> : <Navigate to="/settings" replace/>
}
