import type {EvaluationBatch, EvaluationCaseId, EvaluationResult} from '@/lib/api/evaluation'

export const evaluationStates: Record<EvaluationBatch['state'], string> = {
  running: '运行中', completed: '已结束', cancelled: '已停止', interrupted: '已中断', failed: '评测失败',
}

export const evaluationOutcomes: Record<EvaluationResult['outcome'], string> = {
  passed: '通过', failed: '未通过', error: '运行异常',
}

export function evaluationError(error: unknown) {
  return error instanceof Error ? error.message : '暂时无法读取评测'
}

export function elapsed(ms: number | null | undefined, precision = 0) {
  if (ms == null) return '未记录'
  const total = Math.round(ms / 1000)
  if (total < 60) return `${(ms / 1000).toFixed(precision)} 秒`
  return `${Math.floor(total / 60)} 分 ${total % 60} 秒`
}

export function timingChange(delta: number | null) {
  if (delta == null) return '—'
  const seconds = Math.round(Math.abs(delta) / 1000)
  return seconds ? `${delta < 0 ? '快' : '慢'} ${elapsed(Math.abs(delta))}` : '持平'
}

export function batchRuns(batch: EvaluationBatch, caseId: EvaluationCaseId, side: EvaluationResult['side']) {
  return (batch.results ?? []).filter(item => item.case_id === caseId && item.side === side)
}

function measured(result: EvaluationResult) {
  return result.outcome === 'error' ? null : result.metrics?.elapsed_ms ?? null
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  const midpoint = Math.floor(sorted.length / 2)
  if (!sorted.length) return null
  return sorted.length % 2 ? sorted[midpoint] : (sorted[midpoint - 1] + sorted[midpoint]) / 2
}

export function caseSummary(batch: EvaluationBatch, caseId: EvaluationCaseId) {
  const baseline = batchRuns(batch, caseId, 'baseline')
  const current = batchRuns(batch, caseId, 'candidate')
  const sides = batch.baseline ? [baseline, current] : [current]
  const observed = sides.flat()
  const finished = sides.every(results => results.length === batch.repeats)
  const passed = (results: EvaluationResult[]) => results.filter(result => result.outcome === 'passed').length
  const errors = observed.filter(result => result.outcome === 'error').length
  const failure = [...current, ...baseline].find(result => result.outcome !== 'passed')
  const failedCheck = failure?.checks?.find(check => !check.passed)
  const reason = failure?.note || (failedCheck && `${failedCheck.label}：${failedCheck.detail}`)
  let label = batch.state === 'running' ? '等待结果' : '未运行'
  if (observed.length) {
    if (!finished) label = `已记录 ${observed.length}/${sides.length * batch.repeats}`
    else if (errors) label = `${errors} 次运行异常`
    else if (batch.repeats === 1 && batch.baseline) {
      if (passed(baseline) && passed(current)) label = '两版通过'
      else if (passed(current)) label = '当前通过'
      else if (passed(baseline)) label = '当前未通过'
      else label = '两版未通过'
    } else if (batch.repeats === 1) label = evaluationOutcomes[current[0].outcome]
    else label = batch.baseline
      ? `通过 ${passed(baseline)}/${batch.repeats} → ${passed(current)}/${batch.repeats}`
      : `${passed(current)}/${batch.repeats} 通过`
  }
  const toTimes = (results: EvaluationResult[]) => results.map(measured).filter((time): time is number => time != null)
  const baseTimes = toTimes(baseline)
  const currentTimes = toTimes(current)
  const baseTime = median(baseTimes)
  const currentTime = median(currentTimes)
  const currentPassed = finished && !errors && current.every(result => result.outcome === 'passed')
  return {
    label,
    tone: currentPassed ? 'passed' : failure ? 'failed' : finished ? 'passed' : 'pending',
    reason: reason && batch.baseline && failure ? `${failure.side === 'baseline' ? '基准' : '当前'} · ${reason}` : reason,
    baseTime,
    currentTime,
    delta: baseTime != null && currentTime != null && baseTimes.length === batch.repeats && currentTimes.length === batch.repeats
      ? currentTime - baseTime : null,
  }
}
