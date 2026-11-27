import {useEffect, useRef, useState} from 'react'
import {LoadError} from '@/components/settings/form'
import {SettingsRow, SettingsSegment} from '@/components/settings/settings-row'
import {Button} from '@/components/ui/button'
import {Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger} from '@/components/ui/dialog'
import {Loader2, Plus} from '@/components/ui/icons'
import {Select} from '@/components/ui/select'
import {configApi} from '@/lib/api/config'
import type {EvaluationBatch, EvaluationCaseId, EvaluationOverview, EvaluationStart} from '@/lib/api/evaluation'
import type {ModelCatalog} from '@/lib/api/types'
import {evaluationError} from '@/lib/evaluation-summary'

type Comparison = 'current' | 'fresh' | 'saved'

const repetitions = [{value: '1', label: '1 次'}, {value: '2', label: '2 次'}, {value: '3', label: '3 次'}] as const

export function EvaluationStartDialog({overview, running, dateLabel, onStart, focusResults}: {
  overview: EvaluationOverview
  running: boolean
  dateLabel: (batch: EvaluationBatch) => string
  onStart: (request: EvaluationStart) => Promise<void>
  focusResults: () => void
}) {
  const [open, setOpen] = useState(false)
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const [model, setModel] = useState('')
  const [comparison, setComparison] = useState<Comparison>('current')
  const [referenceId, setReferenceId] = useState('')
  const [selected, setSelected] = useState(() => overview.catalog.cases.map(item => item.id))
  const [repeat, setRepeat] = useState<'1' | '2' | '3'>('1')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const lastRequest = useRef<EvaluationStart | null>(null)
  const pending = useRef(false)
  const submitted = useRef(false)
  const repeats = Number(repeat)

  useEffect(() => {
    if (!open) return
    let current = true
    configApi.getModels().then(value => {
      if (!current) return
      const usable = value.models.filter(item => !item.connection_issue)
      setCatalog(value)
      setCatalogError(null)
      setModel(previous => usable.some(entry => entry.id === previous) ? previous
        : usable.find(entry => entry.id === value.default_model)?.id ?? usable[0]?.id ?? '')
    }).catch(reason => {
      if (current) setCatalogError(evaluationError(reason))
    })
    return () => {current = false}
  }, [open, revision])

  const references = overview.batches.filter(item =>
    item.state === 'completed' && item.model === model && item.repeats === repeats
    && item.cases.join() === selected.join()
    && (item.results ?? []).filter(result => result.side === 'candidate' && result.outcome !== 'error').length === selected.length * repeats
  )
  const reference = references.find(item => item.id === referenceId) ?? references[0]
  const modes: {value: Comparison; label: string}[] = [{value: 'current', label: '仅当前版'}]
  if (overview.catalog.baseline) modes.push({value: 'fresh', label: '两版实跑'})
  modes.push({value: 'saved', label: '已有结果'})
  const invalid = (comparison === 'fresh' && !overview.catalog.baseline) || (comparison === 'saved' && !reference)
  const total = selected.length * repeats * (comparison === 'fresh' ? 2 : 1)
  const usable = catalog?.models.filter(item => !item.connection_issue) ?? []

  function changed() {
    lastRequest.current = null
    setError(null)
  }

  function toggle(id: EvaluationCaseId) {
    setSelected(overview.catalog.cases.map(item => item.id)
      .filter(item => item === id ? !selected.includes(id) : selected.includes(item)))
    changed()
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (pending.current || !model || !selected.length || invalid || running || catalogError) return
    pending.current = true
    setBusy(true)
    setError(null)
    const request: EvaluationStart = lastRequest.current ?? {
      model, cases: selected, repeats, compare: comparison === 'fresh', request_id: crypto.randomUUID(),
      reference_id: comparison === 'saved' ? reference?.id : undefined,
    }
    lastRequest.current = request
    try {
      await onStart(request)
      lastRequest.current = null
      submitted.current = true
      setOpen(false)
    } catch (reason) {
      setError(evaluationError(reason))
    } finally {
      pending.current = false
      setBusy(false)
    }
  }

  return <Dialog open={open} onOpenChange={next => {if (!pending.current) setOpen(next)}}>
    <DialogTrigger asChild>
      <Button size="sm" disabled={running}><Plus aria-hidden/>新建评测</Button>
    </DialogTrigger>
    <DialogContent className="gap-0 p-0 sm:max-w-[36rem]" showCloseButton={!busy} onInteractOutside={event => event.preventDefault()}
      onCloseAutoFocus={event => {
        if (!submitted.current) return
        submitted.current = false
        event.preventDefault()
        focusResults()
      }}>
      <DialogHeader className="px-5 pt-5 pb-3 sm:px-6">
        <DialogTitle>新建评测</DialogTitle>
        <DialogDescription>使用固定材料和所选模型，结果保存在本机。</DialogDescription>
      </DialogHeader>
      <form onSubmit={event => void submit(event)} className="flex max-h-[calc(100dvh-9rem)] min-h-0 flex-col">
        <div className="overflow-y-auto px-5 sm:px-6">
          {catalogError && <LoadError message={catalogError} onRetry={() => {setCatalogError(null); setRevision(value => value + 1)}}/>}
          <div className="divide-y divide-border/70">
            <SettingsRow title="模型" id="evaluation-model" htmlFor="evaluation-model-select" control={
              <Select id="evaluation-model-select" label="模型" value={model} disabled={!usable.length || busy} onChange={value => {setModel(value); changed()}}
                displayValue={model || (catalog ? '没有可用模型' : '正在读取模型')}
                options={usable.map(item => ({id: item.id, label: item.id}))} className="mt-0 w-40"/>
            }/>
            <SettingsRow title="基准" description={
              comparison === 'fresh' ? `与 ${overview.catalog.baseline ?? '已配置旧版'} 分别运行同一组用例。`
                : comparison === 'saved' && !reference ? '当前模型、用例和次数没有匹配的历史结果。' : undefined
            } control={
              <SettingsSegment label="基准" value={comparison} options={modes} disabled={busy}
                onChange={value => {setComparison(value); changed()}}/>
            }/>
            {comparison === 'saved' && reference && <SettingsRow title="基准记录" id="evaluation-reference" htmlFor="evaluation-reference-select" control={
              <Select id="evaluation-reference-select" label="基准记录" value={reference.id} disabled={busy}
                options={references.map(item => ({id: item.id, label: `${dateLabel(item)} · ${item.candidate}`}))}
                onChange={value => {setReferenceId(value); changed()}} className="mt-0 w-56"/>
            }/>}
            <SettingsRow title="每个用例" control={
              <SettingsSegment label="每个用例运行次数" value={repeat} options={repetitions} disabled={busy} onChange={value => {setRepeat(value); changed()}}/>
            }/>
            <fieldset disabled={busy} className="min-w-0 py-3.5">
              <legend className="sr-only">用例</legend>
              <p aria-hidden className="mb-2 text-sm font-medium">用例</p>
              {overview.catalog.cases.map(item => <label key={item.id} className="flex items-start gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-muted/55">
                <input type="checkbox" checked={selected.includes(item.id)} onChange={() => toggle(item.id)} className="mt-0.5 shrink-0 accent-signal"/>
                <span><span className="block">{item.title}</span><span className="text-meta text-muted-foreground">{item.criteria}</span></span>
              </label>)}
            </fieldset>
          </div>
          {error && <p role="alert" className="mb-3 text-sm text-state-failed">{error}</p>}
        </div>
        <DialogFooter className="items-center border-t border-border/70 px-5 py-3 sm:px-6 sm:justify-between">
          <p role="status" className="text-meta tabular-nums text-muted-foreground">{selected.length} 项用例 · 预计新运行 {total} 次</p>
          <div className="flex items-center justify-end gap-2">
            <DialogClose asChild><Button size="sm" variant="ghost" disabled={busy}>取消</Button></DialogClose>
            <Button size="sm" type="submit" disabled={busy || running || !model || !selected.length || invalid || !!catalogError}>
              {busy && <Loader2 className="motion-safe:animate-spin" aria-hidden/>}开始评测
            </Button>
          </div>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
}
