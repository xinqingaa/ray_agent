import {useId, useState, type ReactNode} from 'react'
import {toast} from 'sonner'
import {MarkdownContent} from '@/components/markdown-content'
import {FilePreviewDialog} from '@/components/preview/file-preview-dialog'
import {FileRow, fileMenuEntries} from '@/components/preview/file-row'
import {fileExtension, previewUnavailableReason} from '@/components/run/file-icon'
import {Button} from '@/components/ui/button'
import {IconAction} from '@/components/ui/icon-action'
import {Clock3, Download, Eye, ListChecks, X} from '@/components/ui/icons'
import {SegmentedControl} from '@/components/ui/segmented-control'
import {SettingsSegment} from '@/components/settings/settings-row'
import type {EvaluationArtifact, EvaluationBatch, EvaluationCaseId, EvaluationResult} from '@/lib/api/evaluation'
import {downloadSessionFile} from '@/components/workbench/workbench'
import {batchRuns, elapsed, evaluationError, evaluationOutcomes, timingChange} from '@/lib/evaluation-summary'
import type {FileView} from '@/lib/session-view'
import {cn} from '@/lib/utils'

type View = 'evidence' | 'timing' | 'review'
type Vote = 'A' | 'B' | 'tie'
type Metrics = NonNullable<EvaluationResult['metrics']>
type Side = {label: string; result?: EvaluationResult}
type OpenFile = (file: FileView) => void

const outcomeTone: Record<EvaluationResult['outcome'], string> = {
  passed: 'text-state-success', failed: 'text-state-failed', error: 'text-state-failed',
}

function costs(metrics: Metrics) {
  const {cost_nano_usd: usd, cost_nano_cny: cny} = metrics
  return [usd == null ? null : `US$${(usd / 1e9).toFixed(4)}`, cny == null ? null : `¥${(cny / 1e9).toFixed(4)}`].filter(Boolean).join(' / ') || '未记录'
}

function toFile(artifact: EvaluationArtifact): FileView {
  return {
    id: artifact.file_id, filename: artifact.filename, extension: fileExtension(artifact.filename),
    size: null, path: null, source: 'delivery', contentType: '',
  }
}

async function download(file: FileView) {
  try {
    await downloadSessionFile(file)
  } catch (reason) {
    toast.error(evaluationError(reason))
  }
}

function ArtifactRows({sides, onOpen}: {sides: Side[]; onOpen: OpenFile}) {
  const files = sides.flatMap(side => (side.result?.artifacts ?? []).map(artifact => ({artifact, label: side.label})))
  return files.length > 0 && <ul className="space-y-0.5" aria-label="交付件">
    {files.map(({artifact, label}) => {
      const file = toFile(artifact)
      const unavailable = previewUnavailableReason(file.extension)
      return <li key={`${label}:${file.id}`}>
        <FileRow file={file} versionLabel={label} onOpen={unavailable ? undefined : () => onOpen(file)}
          menu={fileMenuEntries(file, {onPreview: onOpen, onDownload: item => void download(item)})}
          actions={<IconAction label={`下载 ${file.filename}`} className="size-6" onClick={() => void download(file)}><Download/></IconAction>}>
          {unavailable && <span className="block text-xs text-faint">仅下载</span>}
        </FileRow>
      </li>
    })}
  </ul>
}

function Replies({sides}: {sides: Side[]}) {
  return sides.map(({label, result}) => result?.reply && <details key={label} className="text-sm">
    <summary className="cursor-pointer rounded text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">{label}答复</summary>
    <MarkdownContent content={result.reply} className="mt-2"/>
  </details>)
}

function EvidenceTable({columns, rows, label, numeric = false}: {
  columns: string[]
  rows: {label: string; cells: ReactNode[]}[]
  label: string
  numeric?: boolean
}) {
  return <table aria-label={label} className="w-full table-fixed text-left text-meta">
    <colgroup><col className={columns.length > 1 ? 'w-[37%]' : 'w-1/2'}/></colgroup>
    <thead className="border-b border-border/70 text-muted-foreground">
      <tr><th scope="col" className="pb-1.5 pr-2 font-normal">{label}</th>
        {columns.map(name => <th key={name} scope="col" className={cn("pb-1.5 pl-2 font-normal", numeric && "text-right")}>{name}</th>)}</tr>
    </thead>
    <tbody className="divide-y divide-border/60">
      {rows.map(row => <tr key={row.label}>
        <th scope="row" className="break-words py-2 pr-2 align-top font-medium">{row.label}</th>
        {row.cells.map((value, index) => <td key={columns[index]} className={cn("break-words py-2 pl-2 align-top", numeric && "text-right")}>{value}</td>)}
      </tr>)}
    </tbody>
  </table>
}

function Verification({sides, onOpen}: {sides: Side[]; onOpen: OpenFile}) {
  const checks = [...new Set(sides.flatMap(side => side.result?.checks?.map(check => check.label) ?? []))]
  const rows: {label: string; cells: ReactNode[]}[] = [{
    label: '交付判定', cells: sides.map(({result}) => result
      ? <><span className={outcomeTone[result.outcome]}>{evaluationOutcomes[result.outcome]}</span>
        {result.note && <p className="mt-0.5 text-muted-foreground">{result.note}</p>}</>
      : <span className="text-faint">—</span>),
  }, ...checks.map(label => ({
    label, cells: sides.map(({result}) => {
      const check = result?.checks?.find(item => item.label === label)
      return check
        ? <><span className={check.passed ? 'text-state-success' : 'text-state-failed'}>{check.passed ? '通过' : '未通过'}</span>
          {check.detail && <p className="mt-0.5 text-muted-foreground">{check.detail}</p>}</>
        : <span className="text-faint">—</span>
    }),
  }))]
  return <div className="space-y-4">
    <EvidenceTable label="核验项" columns={sides.map(side => side.label)} rows={rows}/>
    {sides.some(side => side.result?.artifacts?.length) && <section>
      <h3 className="mb-1.5 text-sm font-medium">成果</h3>
      <ArtifactRows sides={sides} onOpen={onOpen}/>
    </section>}
    <Replies sides={sides}/>
  </div>
}

const number = new Intl.NumberFormat('zh-CN')
const metrics: {label: string; format: (value: Metrics) => string}[] = [
  {label: '任务耗时', format: value => elapsed(value.elapsed_ms, 1)},
  {label: '模型首段', format: value => elapsed(value.first_model_ms, 1)},
  {label: '模型请求累计', format: value => elapsed(value.model_ms, 1)},
  {label: '工具调用累计', format: value => elapsed(value.tool_ms, 1)},
  {label: '模型请求', format: value => number.format(value.model_requests)},
  {label: '工具调用', format: value => number.format(value.tool_calls)},
  {label: '输入 Token', format: value => value.input_tokens == null ? '未记录' : number.format(value.input_tokens)},
  {label: '输出 Token', format: value => value.output_tokens == null ? '未记录' : number.format(value.output_tokens)},
  {label: '估算费用', format: costs},
]

function Timing({sides}: {sides: Side[]}) {
  const [first, second] = sides
  const baseline = first.result?.metrics
  const candidate = second?.result?.metrics
  const delta = baseline && candidate && first.result?.outcome !== 'error' && second?.result?.outcome !== 'error'
    ? candidate.elapsed_ms - baseline.elapsed_ms : null
  return <div className="space-y-3">
    {delta != null && <p className="tabular-nums text-sm font-medium">当前版{timingChange(delta)}</p>}
    <EvidenceTable label="计量" numeric columns={sides.map(side => side.label)}
      rows={metrics.map(({label, format}) => ({
        label, cells: sides.map(({result}) => <span className={cn('tabular-nums', !result?.metrics && 'text-faint')}>{result?.metrics ? format(result.metrics) : '—'}</span>),
      }))}/>
    <p className="text-meta leading-5 text-muted-foreground">模型和工具耗时是各自的累计记录。并行工具会重叠，以任务耗时为准。</p>
  </div>
}

function BlindReview({identifier, sides, onOpen}: {identifier: string; sides: Side[]; onOpen: OpenFile}) {
  const storageKey = `rayagent:evaluation-review:${identifier}`
  const [vote, setVote] = useState<Vote | null>(() => {
    try {
      const saved = window.localStorage.getItem(storageKey)
      if (saved === 'A' || saved === 'B' || saved === 'tie') return saved
    } catch { /* 私有存储不可用时只保留本次选择 */ }
    return null
  })
  const choices: [Vote, string][] = [['A', '更愿意用 A'], ['B', '更愿意用 B'], ['tie', '差不多']]
  if (!sides.every(side => side.result)) return <p className="text-sm text-muted-foreground">两版都有运行记录后可以评审。</p>
  if (!sides.every(side => side.result?.artifacts?.length || side.result?.reply)) {
    return <p className="text-sm text-muted-foreground">两版都需要有可查看的成果或答复才能评审。</p>
  }

  return <div className="space-y-3">
    <p className="text-sm text-muted-foreground">选一份你更愿意直接使用的成果。</p>
    {sides.map(side => <section key={side.label} className="space-y-2 border-b border-border/60 pb-3">
      <h3 className="text-sm font-medium">方案 {side.label}</h3>
      <ArtifactRows sides={[side]} onOpen={onOpen}/>
      <Replies sides={[side]}/>
    </section>)}
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="偏好选择">
      {choices.map(([value, label]) => <Button key={value} size="xs" variant={vote === value ? 'secondary' : 'ghost'}
        aria-pressed={vote === value} onClick={() => {
          setVote(value)
          try {window.localStorage.setItem(storageKey, value)} catch { /* 私有存储不可用时只保留本次选择 */ }
        }}>{label}</Button>)}
    </div>
  </div>
}

export function EvaluationDetail({batch, caseId, title, criteria, onClose}: {
  batch: EvaluationBatch
  caseId: EvaluationCaseId
  title: string
  criteria?: string
  onClose: () => void
}) {
  const [view, setView] = useState<View>('evidence')
  const [repetition, setRepetition] = useState('1')
  const [file, setFile] = useState<FileView | null>(null)
  const id = useId()
  const run = Number(repetition)
  const forSide = (side: EvaluationResult['side']) => batchRuns(batch, caseId, side).find(item => item.repetition === run)
  const pairs = batch.baseline ? [{label: '基准', result: forSide('baseline')}, {label: '当前', result: forSide('candidate')}]
    : [{label: '当前', result: forSide('candidate')}]
  const reviewOrder = (parseInt(batch.id.slice(-1), 16) + batch.cases.indexOf(caseId) + run) % 2
  const masked = (reviewOrder ? [...pairs].reverse() : pairs).map((side, index) => ({...side, label: index === 0 ? 'A' : 'B'}))
  const options = [
    {value: 'evidence' as const, label: '核验', icon: ListChecks},
    {value: 'timing' as const, label: '等待与开销', icon: Clock3},
    ...(batch.baseline ? [{value: 'review' as const, label: '人工评审', icon: Eye}] : []),
  ]

  return <>
    <header className="shrink-0 px-3.5 pt-3.5 pb-2.5">
      <div className="flex items-start justify-between gap-2">
        <h2 className="min-w-0 break-words text-sm font-semibold">{title}</h2>
        <IconAction label="收起用例详情" className="-mt-1 size-7 shrink-0" onClick={onClose}><X/></IconAction>
      </div>
      {criteria && <p className="mt-1 text-meta leading-5 text-muted-foreground">{criteria}</p>}
    </header>
    <div className="task-inspector-tabs flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border/65 px-3.5 pb-2">
      <SegmentedControl value={view} onValueChange={setView} options={options} label="用例详情" appearance="icons" idPrefix={id}/>
      {batch.repeats > 1 && <SettingsSegment label="查看第几次运行" value={repetition}
        options={Array.from({length: batch.repeats}, (_, index) => ({value: String(index + 1), label: `第 ${index + 1} 次`}))}
        onChange={setRepetition}/>}
    </div>
    <div key={view} id={`${id}-panel-${view}`} role="tabpanel" aria-labelledby={`${id}-${view}`} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3.5 py-3.5">
      {view === 'evidence' && <Verification sides={pairs} onOpen={setFile}/>}
      {view === 'timing' && <Timing sides={pairs}/>}
      {view === 'review' && <BlindReview key={repetition} identifier={`${batch.id}:${caseId}:${run}`} sides={masked} onOpen={setFile}/>}
    </div>
    <FilePreviewDialog file={file} onClose={() => setFile(null)} onDownload={item => void download(item)}/>
  </>
}
