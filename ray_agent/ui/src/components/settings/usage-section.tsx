import {Fragment, useEffect, useState} from 'react'
import {Switch} from '@/components/ui/switch'
import {reloadUsagePreferences, setUsagePreferences, useUsagePreferences} from '@/hooks/use-usage-preferences'
import {modelConnectionsApi, MODEL_CONNECTIONS_CHANGED} from '@/lib/api/model-connections'
import type {ConnectionSource} from '@/lib/api/types'
import {USAGE_RECORDED, usageApi, type UsageGroup, type UsageReport} from '@/lib/api/usage'
import {errorMessage, LoadError, SectionHeader} from './form'
import {CostChart, Heatmap, SeriesDot} from './usage-charts'
import {amount, cost, dayOf, fmt, hitRate, providerSeries, rangeLabel, ranges, selectedRange, tokenLabel, wallDate, type Range, type Series} from './usage-format'
import {UsageRangePicker} from './usage-range-picker'
import './usage-section.css'

const purposes: Record<string, string> = {
  main: '主任务', compact: '上下文压缩', title: '会话标题', memory: '记忆提炼',
  summary: '会话摘要', transcribe: '语音转写', connection_test: '模型连接测试',
}
const sourceLabels: Record<string, string> = {deepseek: 'DeepSeek 聊天', 'deepseek-asr': 'DeepSeek 转写', openai: 'OpenAI'}

function delta(value: number | null, previous: number | null) {
  if (previous === null || value === null) return ''
  if (value === previous) return '持平'
  if (!previous) return '新增'
  const change = 100 * Math.abs(value - previous) / previous
  return (value > previous ? '↑ ' : '↓ ') + (change < 1 ? change.toFixed(1) : fmt(Math.round(change))) + '%'
}

function Metrics({report}: {report: UsageReport | null}) {
  const total = report?.totals
  const previous = report?.previous
  const hit = total ? hitRate(total) : null
  const previousHit = previous ? hitRate(previous) : null
  const transcription = report?.purposes.find(item => item.key === 'transcribe')?.requests
  const inputs = total ? `输入 ${tokenLabel(total.input_tokens)} · 输出 ${tokenLabel(total.output_tokens)}` : ''
  const cacheChange = hit !== null && previousHit !== null
    ? hit === previousHit ? '持平' : `${hit > previousHit ? '↑' : '↓'} ${Math.abs(hit - previousHit)} 点` : ''
  const metrics = [
    ['估算费用', cost(total), total?.unpriced_requests ? '含未计价请求' : '美元', delta(amount(total), amount(previous))],
    ['Token', total ? tokenLabel(total.total_tokens) : '—', inputs, delta(total?.total_tokens ?? null, previous?.total_tokens ?? null)],
    ['模型请求', total ? fmt(total.requests) : '—', transcription ? `含 ${fmt(transcription)} 次转写` : '次', delta(total?.requests ?? null, previous?.requests ?? null)],
    ['缓存命中', hit === null ? '—' : hit + '%', total ? `命中 ${tokenLabel(total.cached_tokens)} 输入` : '', cacheChange],
  ]
  return <div className="usage-kpis">{metrics.map(([label, value, description, change]) => <div className="usage-kpi" key={label}>
    <div className="usage-kpi-label"><span>{label}</span>{change && <span title="与上一等长时段对比">{change}</span>}</div>
    <div className="usage-kpi-value" title={value}>{value}</div>
    <div className="usage-kpi-sub" title={description}>{description}</div>
  </div>)}</div>
}

function UsageCells({item, total}: {item: UsageGroup | undefined; total: number}) {
  const requests = item?.requests ?? 0
  const audioOnly = item && !item.input_tokens && !item.output_tokens && item.audio_duration_ms > 0
  const hit = item && hitRate(item)
  const share = Math.max(0, Math.min(100, total > 0 ? 100 * (item?.cost_nano_usd ?? 0) / total : 0))
  return <>
    <td>{fmt(requests)}</td>
    <td title={requests && item && !audioOnly ? fmt(item.input_tokens) : undefined}>{requests && item ? audioOnly ? `音频 ${fmt(Math.round(item.audio_duration_ms / 1000))} 秒` : tokenLabel(item.input_tokens) : '—'}</td>
    <td>{hit == null ? '—' : hit + '%'}</td>
    <td title={requests && item && !audioOnly ? fmt(item.output_tokens) : undefined}>{requests && item && !audioOnly ? tokenLabel(item.output_tokens) : '—'}</td>
    <td title={requests && item?.cost_nano_usd == null ? '未计价' : undefined}>{requests ? cost(item) : '—'}</td>
    <td><span className="usage-share" title={share.toFixed(1) + '%'}><span style={{width: share + '%'}}/></span></td>
  </>
}

function ModelTable({report, series, connections}: {report: UsageReport | null; series: Series[]; connections: ConnectionSource | null}) {
  const total = report?.totals.cost_nano_usd ?? 0
  return <section className="usage-card" aria-label="按提供商与模型">
    <header><h3>按提供商与模型</h3></header>
    {series.length ? <div className="usage-table-wrap">
      <table className="usage-table">
        <thead><tr><th scope="col">提供商 / 模型</th><th scope="col">请求</th><th scope="col">输入</th>
          <th scope="col" title="输入 Token 中命中缓存的比例">缓存</th><th scope="col">输出</th><th scope="col">费用</th><th scope="col">占比</th></tr></thead>
        <tbody>{series.map(item => {
          const provider = report?.providers.find(group => group.key === item.key)
          const models = new Map(provider?.models?.map(model => [model.key, model]))
          const connection = connections?.providers?.find(group => group.name === item.key)
          const configured = [...(connection?.configured_models ?? connection?.models ?? []), ...Object.keys(connection?.custom_models ?? {})]
          const keys = [...new Set([...configured, ...models.keys()])]
          return <Fragment key={item.key}>
            <tr className="usage-provider-row"><th scope="row"><SeriesDot color={item.color}/>{item.label}</th><UsageCells item={provider} total={total}/></tr>
            {keys.map(model => <tr key={model} className="usage-model-row"><th scope="row"><code>{model}</code></th><UsageCells item={models.get(model)} total={total}/></tr>)}
          </Fragment>
        })}</tbody>
      </table>
    </div> : <p className="usage-unit">暂无提供商用量。</p>}
  </section>
}

function Purposes({report}: {report: UsageReport | null}) {
  const top = Math.max(1, ...(report?.purposes ?? []).map(item => item.cost_nano_usd ?? 0))
  return <section className="usage-card" aria-label="按用途">
    <header><h3>按用途</h3><span className="usage-unit">辅助请求同样计入</span></header>
    <dl className="usage-purposes">
      {Object.entries(purposes).map(([key, label]) => {
        const item = report?.purposes.find(row => row.key === key)
        const amount = item?.cost_nano_usd ?? 0
        return <div key={key}>
          <dt>{label}</dt>
          <dd className="usage-purpose-track" aria-hidden><span style={{width: amount > 0 ? Math.max(1, 100 * amount / top) + '%' : '0%'}}/></dd>
          <dd>{item?.requests ? cost(item) : '—'}</dd>
          <dd className="usage-unit">{item ? fmt(item.requests) + ' 次' : '—'}</dd>
        </div>
      })}
    </dl>
  </section>
}

export function UsageSection() {
  const {value: preferences, error: preferenceError} = useUsagePreferences()
  const [range, setRange] = useState<Range>({range_id: '7d'})
  const [provider, setProvider] = useState('')
  const [providerIds, setProviderIds] = useState<string[]>([])
  const [connections, setConnections] = useState<ConnectionSource | null>(null)
  const [snapshot, setSnapshot] = useState<{range: Range; provider: string; report: UsageReport} | null>(null)
  const report = snapshot?.range === range && snapshot.provider === provider ? snapshot.report : null
  const [outlined, setOutlined] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  useEffect(() => {
    const reload = () => setRevision(id => id + 1)
    window.addEventListener(USAGE_RECORDED, reload)
    window.addEventListener(MODEL_CONNECTIONS_CHANGED, reload)
    return () => {
      window.removeEventListener(USAGE_RECORDED, reload)
      window.removeEventListener(MODEL_CONNECTIONS_CHANGED, reload)
    }
  }, [])
  useEffect(() => {
    let live = true
    setLoading(true)
    setError(null)
    const query = range.range_id === 'custom' ? {range_id: range.range_id, start: range.start, end: range.end} : range
    usageApi.report({...query, provider: provider || undefined})
      .then(next => {if (live) setSnapshot({range, provider, report: next})})
      .catch(reason => {if (live) setError(errorMessage(reason, '读取用量失败'))})
      .finally(() => {if (live) setLoading(false)})
    return () => {live = false}
  }, [range, provider, revision])
  useEffect(() => {
    let live = true
    void usageApi.providers().then(ids => {if (live) setProviderIds(ids)}).catch(() => {})
    void modelConnectionsApi.get().then(source => {if (live) setConnections(source)}).catch(() => {})
    return () => {live = false}
  }, [revision])
  const ids = [...new Set([...providerIds, ...(connections?.providers ?? []).map(item => item.name),
    ...(snapshot?.report.providers ?? []).map(item => item.key)])]
  const providers = ids.map(id => providerSeries(id))
  const series = providers.filter(item => !provider || item.key === provider)
  const label = rangeLabel(range)
  const last = snapshot?.report.calendar.at(-1)?.start
  return <section aria-labelledby="usage-title" className="usage-page">
    <SectionHeader id="usage-title" title="用量" description="按请求记录 Token，并按官方标价估算费用。"/>
    <div className="usage-setting">
      <div><label htmlFor="show-conversation-cost">在对话中显示费用</label>
        <p>回复下方显示本次运行的估算费用，悬停查看明细与本对话累计。</p></div>
      <Switch id="show-conversation-cost" checked={preferences?.show_conversation_cost ?? false} disabled={!preferences || saving} onCheckedChange={async checked => {
        setSaving(true)
        setSaveError(null)
        try {await setUsagePreferences({show_conversation_cost: checked})}
        catch (reason) {setSaveError(errorMessage(reason, '保存失败'))}
        finally {setSaving(false)}
      }}/>
    </div>
    {(saveError || preferenceError) && <LoadError message={saveError || preferenceError || ''} onRetry={() => {
      setSaveError(null)
      void reloadUsagePreferences()
    }}/>}
    <div className="usage-filters">
      <div className="usage-segment" role="group" aria-label="时间范围">
        {ranges.map(([id, text]) => <button key={id} type="button" className="usage-segment-button"
          aria-pressed={id === range.range_id} onClick={() => setRange({range_id: id})}>{text}</button>)}
        <UsageRangePicker range={range} first={snapshot ? dayOf(snapshot.report.selectable_from) : ''} last={last ? dayOf(last) : wallDate(new Date())} onApply={setRange}/>
      </div>
      <div className="usage-segment" role="group" aria-label="提供商">
        <button type="button" className="usage-segment-button" aria-pressed={!provider} onClick={() => setProvider('')}>全部</button>
        {providers.map(item => <button key={item.key} type="button" className="usage-segment-button" aria-pressed={item.key === provider}
          onClick={() => setProvider(item.key)}><SeriesDot color={item.color}/>{item.label}</button>)}
      </div>
    </div>
    {error && <LoadError message={error} onRetry={() => setRevision(id => id + 1)}/>}
    <div aria-busy={loading}>
      <Metrics report={report}/>
      <CostChart report={report} label={label} series={series} onDrill={day => setRange(selectedRange(day, day))} onDay={setOutlined}/>
      <Heatmap report={report} label={label} linkedDate={outlined} onDays={(from, to) => setRange(selectedRange(from, to))}/>
      <ModelTable report={report} series={series} connections={connections}/>
      <Purposes report={report}/>
    </div>
    <p className="usage-note">
      费用以美元估算，实际金额以服务商账单为准。DeepSeek 聊天按高峰或低谷计价，法定节假日优惠、缓存写入、账单折扣与赠送额度未计入。无单价的模型只统计 Token，转写按音频时长估算。
      {!!report?.totals.failed_requests && `所选时段有 ${fmt(report.totals.failed_requests)} 次请求失败。`}
      {report?.price_version && <>价格版本 {report.price_version}。价格来源{' '}
        {Object.entries(report.price_sources).map(([key, url], index) => <Fragment key={key}>
          {index > 0 && '、'}<a href={url} target="_blank" rel="noreferrer">{sourceLabels[key] ?? key}</a>
        </Fragment>)}。</>}
    </p>
  </section>
}
