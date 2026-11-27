/* eslint-disable @typescript-eslint/no-require-imports */
// 验证实际页面使用的对比口径，包括单次、重复和异常。
const assert = require('node:assert/strict')
const {createLoader} = require('./workspace-loader.cjs')

const {caseSummary, elapsed, timingChange} = createLoader()('src/lib/evaluation-summary.ts')
const run = (side, repetition, elapsedMs, outcome = 'passed', extra = {}) => ({
  case_id: 'ppt', side, repetition, outcome,
  ...(elapsedMs == null ? {} : {metrics: {elapsed_ms: elapsedMs}}), ...extra,
})
const batch = (results, repeats = 1, state = 'completed', baseline = 'old') => ({baseline, repeats, state, results})

const complete = caseSummary(batch([run('baseline', 1, 232200), run('candidate', 1, 181100)]), 'ppt')
assert.equal(complete.label, '两版通过')
assert.equal(elapsed(complete.baseTime), '3 分 52 秒')
assert.equal(elapsed(complete.currentTime), '3 分 1 秒')
assert.equal(timingChange(complete.delta), '快 51 秒')
assert.equal(elapsed(119900), '2 分 0 秒')

const repeated = caseSummary(batch([
  run('baseline', 1, 4000), run('baseline', 2, 6000),
  run('candidate', 1, 9000), run('candidate', 2, 2000),
], 2), 'ppt')
assert.equal(repeated.label, '通过 2/2 → 2/2')
assert.equal(repeated.baseTime, 5000)
assert.equal(repeated.currentTime, 5500)

const failure = caseSummary(batch([
  run('baseline', 1, 4000),
  run('candidate', 1, 6400, 'failed', {checks: [{label: 'PDF 正文', detail: '未找到复访日期', passed: false}]}),
]), 'ppt')
assert.equal(failure.label, '当前未通过')
assert.equal(failure.reason, '当前 · PDF 正文：未找到复访日期')
assert.equal(failure.tone, 'failed')

const interrupted = caseSummary(batch([
  run('baseline', 1, 6000), run('candidate', 1, 1000, 'error', {note: '模型连接中断'}),
]), 'ppt')
assert.equal(interrupted.label, '1 次运行异常')
assert.equal(interrupted.currentTime, null)
assert.equal(interrupted.delta, null)

const partial = caseSummary(batch([run('baseline', 1, 4000)], 1, 'running'), 'ppt')
assert.equal(partial.label, '已记录 1/2')
assert.equal(partial.delta, null)
assert.equal(caseSummary(batch([run('candidate', 1, 4000)], 1, 'completed', null), 'ppt').label, '通过')
console.log('评测汇总口径检查通过')
