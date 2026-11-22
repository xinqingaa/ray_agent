import {useEffect, useRef, useState, type KeyboardEvent} from 'react'
import {formatEstimatedCost, type UsageBucket, type UsageHour, type UsageReport, type UsageTotals} from '@/lib/api/usage'
import {cn} from '@/lib/utils'
import {cost, dayLabel, dayOf, dayWeek, fmt, pad, priceLabels, shortDay, timeOf, tokenLabel, weekdays, type Series} from './usage-format'

export function SeriesDot({color}: {color: string}) {
  return <span className="usage-dot" style={{backgroundColor: color}} aria-hidden/>
}

const moves = (horizontal: number, vertical: number): Record<string, number> => ({
  ArrowLeft: -horizontal, ArrowRight: horizontal, ArrowUp: -vertical, ArrowDown: vertical,
})

function chartKey(event: KeyboardEvent, index: number | null, length: number, horizontal: number, vertical: number) {
  const step = moves(horizontal, vertical)[event.key]
  if (!step || !length) return null
  event.preventDefault()
  return index === null ? 0 : Math.min(length - 1, Math.max(0, index + step))
}

function roundedBar(x: number, y: number, w: number, h: number) {
  const r = Math.min(4, w / 2, h)
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`
}

function costTicks(max: number) {
  if (max <= 0) return [0]
  const raw = max / 4
  const unit = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map(factor => factor * unit).find(size => size >= raw) ?? raw
  return Array.from({length: 1 + Math.ceil(max / step)}, (_, i) => i * step)
}

function bucketTitle(item: UsageBucket, unit: UsageReport['bucket_unit']) {
  const end = timeOf(item.end) === '00:00' && dayOf(item.start) !== dayOf(item.end) ? '24:00' : timeOf(item.end)
  return unit === 'day' ? dayLabel(item.start) : `${dayLabel(item.start)} ${timeOf(item.start)}–${end}`
}

export function CostChart({report, series, label, onDrill, onDay}: {
  report: UsageReport | null; series: Series[]; label: string
  onDrill: (day: string) => void; onDay: (day: string | null) => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(400)
  const [focus, setFocus] = useState<number | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  const buckets = report?.buckets ?? []
  const active = hover ?? focus
  const current = active == null ? null : buckets[active]
  const unit = report?.bucket_unit
  const drillable = !!unit && unit !== 'hour'
  useEffect(() => {
    if (!host.current) return
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(240, Math.floor(entry.contentRect.width))))
    observer.observe(host.current)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {onDay(current ? dayOf(current.start) : null)}, [current, onDay])
  useEffect(() => {setFocus(null); setHover(null)}, [report?.start, report?.end])

  const top = 10, base = 164, left = 60, right = width - 8
  const slot = (right - left) / Math.max(buckets.length, 1)
  const barWidth = Math.min(26, slot * .62)
  const ticks = costTicks(Math.max(0, ...buckets.map(bucket => bucket.cost_nano_usd ?? 0)))
  const ceiling = ticks.at(-1) || 1
  const yOf = (n: number) => base - n / ceiling * (base - top)
  const labelEvery = Math.max(1, Math.ceil(46 / slot))
  const legend = new Map(series.map(item => [item.key, item]))
  const select = (index: number) => {if (drillable && buckets[index]) onDrill(dayOf(buckets[index].start))}

  return <section className="usage-card" aria-label="费用趋势">
    <header>
      <h3>费用趋势</h3>
      <span className="usage-unit">{label}{unit && ' · ' + {hour: '按小时', '3h': '每 3 小时', day: '按天'}[unit]}</span>
      <div className="usage-legend">{series.map(item => <span key={item.key}><SeriesDot color={item.color}/>{item.label}</span>)}</div>
    </header>
    <div className="usage-readout" aria-live="polite">
      {current && unit ? <>
        <span>{bucketTitle(current, unit)} · </span><b>{cost(current)}</b>
        <span> · {fmt(current.requests)} 次请求</span>
        {(current.providers ?? []).map(group => {
          const item = legend.get(group.key)
          return item && <span className="usage-part" key={group.key}><SeriesDot color={item.color}/>{item.label} {cost(group)}</span>
        })}
      </> : report && <>
        <span>{label}共 </span><b>{cost(report.totals)}</b>
        <span> · {fmt(report.totals.requests)} 次请求{report.totals.requests > 0 ? ' · 悬停柱子查看每段' + (drillable ? '，点击查看当天按小时' : '') : ''}</span>
      </>}
    </div>
    <div className="usage-chart" ref={host}>
      <svg className={cn('usage-plot', {'can-drill': drillable})} width={width} height={188}
        tabIndex={buckets.length ? 0 : undefined} role="img" aria-label={`${label}费用趋势，方向键逐段查看`}
        onFocus={() => setFocus(index => index ?? (buckets.length ? 0 : null))}
        onBlur={() => setFocus(null)} onPointerLeave={() => setHover(null)}
        onKeyDown={event => {
          const index = chartKey(event, focus, buckets.length, 1, 1)
          if (index !== null) {setHover(null); setFocus(index)}
          if (event.key === 'Enter' && focus !== null) {event.preventDefault(); select(focus)}
          if (event.key === 'Escape' && active !== null) {event.stopPropagation(); setFocus(null); setHover(null)}
        }}>
        {ticks.map(tick => <g key={tick}>
          <line x1={left} x2={right} y1={yOf(tick)} y2={yOf(tick)} className={tick === 0 ? 'usage-baseline' : 'usage-gridline'}/>
          <text x={left - 8} y={yOf(tick)} textAnchor="end" dominantBaseline="middle">{tick ? formatEstimatedCost(tick) : '0'}</text>
        </g>)}
        {buckets.map((bucket, index) => {
          const x = left + slot * index
          const byProvider = new Map((bucket.providers ?? []).map(group => [group.key, group.cost_nano_usd ?? 0]))
          const segments = series.filter(item => (byProvider.get(item.key) ?? 0) > 0)
          let bottom = 0
          return <g key={bucket.start}>
            <g className={cn('usage-bar-segments', {'is-dim': active !== null && active !== index})}>
              {segments.map((item, inner) => {
                const amount = byProvider.get(item.key) ?? 0
                const y = yOf(bottom + amount)
                const height = Math.max(0, yOf(bottom) - y - (inner === 0 ? 0 : 1))
                bottom += amount
                const barX = x + (slot - barWidth) / 2
                return inner === segments.length - 1
                  ? <path key={item.key} d={roundedBar(barX, y, barWidth, height)} fill={item.color}/>
                  : <rect key={item.key} x={barX} y={y} width={barWidth} height={height} fill={item.color}/>
              })}
            </g>
            {index % labelEvery === 0 && <text x={x + slot / 2} y={181} textAnchor="middle">
              {unit === 'hour' ? timeOf(bucket.start) : unit === '3h' && index > 0 && dayOf(bucket.start) === dayOf(buckets[index - 1].start) ? timeOf(bucket.start) : shortDay(bucket.start)}
            </text>}
            <rect className={cn('usage-hit', {'is-active': active === index})} x={x} y={top} width={slot} height={base - top}
              onPointerEnter={() => setHover(index)} onClick={event => {
                event.currentTarget.ownerSVGElement?.focus({preventScroll: true})
                setFocus(index)
                select(index)
              }}/>
          </g>
        })}
      </svg>
      {report && !report.totals.requests && <p className="usage-empty">这段时间没有模型请求。</p>}
    </div>
  </section>
}

type Cell = UsageBucket | UsageHour
const isDay = (cell: Cell): cell is UsageBucket => 'start' in cell
const cellTitle = (cell: Cell) => isDay(cell)
  ? `${dayLabel(cell.start)} 周${weekdays[dayWeek(cell.start)]}`
  : `周${weekdays[cell.weekday]} ${pad(cell.hour)}:00–${pad(cell.hour + 1)}:00`

function CellDetail({cell}: {cell: Cell}) {
  const definition: [string, string, string?][] = [
    ['估算费用', cell.requests ? cost(cell) : '—'],
    ['请求', fmt(cell.requests) + ' 次'],
    ['Token 用量', tokenLabel(cell.total_tokens), `输入 ${fmt(cell.input_tokens)} · 输出 ${fmt(cell.output_tokens)}`],
  ]
  if (!isDay(cell) && cell.deepseek_peak !== undefined) definition.push(['DeepSeek 计价', cell.deepseek_peak ? '高峰 · 原价' : '低谷 · 半价'])
  else if (cell.price_periods?.length) definition.push(['记录中的计价', cell.price_periods.map(period => priceLabels[period] ?? period).join(' / ')])
  return <>
    <strong className="usage-side-title">{cellTitle(cell)}</strong>
    <dl>{definition.map(([key, value, hint]) => <div key={key}><dt>{key}</dt><dd title={hint}>{value}</dd></div>)}</dl>
    <div className="usage-side-models">
      <div className="usage-unit">主要模型</div>
      {cell.top_models?.length ? <ul>{cell.top_models.map(model => <li key={model}><code title={model}>{model}</code>
        <span className="usage-unit">{cell.top_model_counts?.[model] ?? ''}</span></li>)}</ul> : '—'}
    </div>
  </>
}

function HeatSummary({report, calendar, label}: {report: UsageReport; calendar: boolean; label: string}) {
  const active = report.calendar.filter(day => day.requests)
  const priced = active.filter(day => day.cost_nano_usd !== null)
  const highest = priced.reduce<UsageBucket | null>((top, day) => !top || (day.cost_nano_usd ?? 0) > (top.cost_nano_usd ?? 0) ? day : top, null)
  const busiest = report.hours.reduce<UsageHour | null>((top, hour) => !top || hour.requests > top.requests ? hour : top, null)
  const tokens = calendar ? active.reduce((sum, day) => sum + day.total_tokens, 0) : report.totals.total_tokens
  return <>
    <strong className="usage-side-title">{calendar ? '近 13 周' : label}</strong>
    <dl>{calendar ? <>
      <div><dt>日均</dt><dd>{priced.length ? formatEstimatedCost(priced.reduce((sum, day) => sum + (day.cost_nano_usd ?? 0), 0) / priced.length) : '—'}</dd></div>
      <div><dt>最高</dt><dd>{highest ? `${dayLabel(highest.start)} · ${cost(highest)}` : '—'}</dd></div>
      <div><dt>有用量</dt><dd>{active.length} / {report.calendar.length} 天</dd></div>
    </> : <>
      <div><dt>最忙时段</dt><dd>{busiest?.requests ? cellTitle(busiest) : '—'}</dd></div>
      <div><dt>有请求的时段</dt><dd>{report.hours.filter(hour => hour.requests).length} / 168</dd></div>
    </>}<div><dt>Token 用量</dt><dd title={fmt(tokens)}>{tokenLabel(tokens)}</dd></div></dl>
  </>
}

export function Heatmap({report, linkedDate, label, onDays}: {
  report: UsageReport | null; linkedDate: string | null; label: string
  onDays: (first: string, last: string) => void
}) {
  const [calendar, setCalendar] = useState(true)
  const [peak, setPeak] = useState(false)
  const [hover, setHover] = useState<number | null>(null)
  const [focus, setFocus] = useState<number | null>(null)
  const [pinned, setPinned] = useState<number | null>(null)
  const [anchor, setAnchor] = useState<string | null>(null)
  const [activeLevel, setActiveLevel] = useState<number | null>(null)
  const cells: Cell[] = (calendar ? report?.calendar : report?.hours) ?? []
  const reading = hover ?? focus ?? pinned
  const current = reading === null ? null : cells[reading]
  const offset = report?.calendar.length ? dayWeek(report.calendar[0].start) : 0
  const size = calendar ? 17 : 13
  const pitch = size + (calendar ? 4 : 2)
  const width = 28 + (calendar ? Math.ceil((offset + cells.length) / 7) : 24) * pitch
  const height = 20 + 7 * pitch
  const rowOf = (index: number) => calendar ? (offset + index) % 7 : Math.floor(index / 24)
  const colOf = (index: number) => calendar ? Math.floor((offset + index) / 7) : index % 24
  const positives = cells.map(cell => cell.cost_nano_usd ?? 0).filter(value => value > 0).sort((a, b) => a - b)
  const cuts = [.25, .5, .75].map(quantile => positives[Math.floor(quantile * positives.length)] ?? Infinity)
  const levelOf = (cell: UsageTotals) => (cell.cost_nano_usd ?? 0) <= 0 ? 0 : 1 + cuts.filter(cut => (cell.cost_nano_usd ?? 0) > cut).length
  const columns: {col: number; label: string}[] = []
  if (calendar) {
    report?.calendar.forEach((day, index, all) => {
      if (index && day.start.slice(0, 7) !== all[index - 1].start.slice(0, 7)) {
        const col = colOf(index) + (rowOf(index) > 3 ? 1 : 0)
        if (28 + col * pitch + 25 <= width && (!columns.length || col - columns[columns.length - 1].col >= 3)) {
          columns.push({col, label: Number(day.start.slice(5, 7)) + '月'})
        }
      }
    })
  } else [0, 6, 12, 18].forEach(col => columns.push({col, label: col + '时'}))

  const choose = (index: number, shift: boolean) => {
    const cell = cells[index]
    if (!cell) return
    if (isDay(cell)) {
      const day = dayOf(cell.start)
      const [first, last] = shift && anchor ? [day, anchor].sort() : [day, day]
      if (!shift || !anchor) setAnchor(day)
      setFocus(index)
      onDays(first, last)
    } else setPinned(existing => existing === index ? null : index)
  }

  const changeMode = (next: boolean) => {
    if (next === calendar) return
    setCalendar(next)
    setFocus(null)
    setHover(null)
    setPinned(null)
    setActiveLevel(null)
  }

  return <section className="usage-card usage-heat-card" aria-label="使用热力">
    <header>
      <div className="usage-heat-title"><h3>使用热力</h3><span className="usage-unit">{calendar ? '近 13 周 · 所选时段高亮' : label + ' · 星期 × 小时'}</span></div>
      <div className="usage-heat-controls">
        {!calendar && <button type="button" className="usage-peak" aria-pressed={peak} onClick={() => setPeak(value => !value)}>标出 DeepSeek 高峰</button>}
        <div className="usage-segment" role="group" aria-label="热力图视角">
          <button type="button" className="usage-segment-button" aria-pressed={calendar} onClick={() => changeMode(true)}>日历</button>
          <button type="button" className="usage-segment-button" aria-pressed={!calendar} onClick={() => changeMode(false)}>时段</button>
        </div>
      </div>
    </header>
    <div className="usage-heat">
      <div className="usage-heat-plot">
        <svg className="usage-plot" width={width} height={height} role="img" tabIndex={cells.length ? 0 : undefined}
          aria-label={calendar ? '近 13 周每天的费用热力图' : '星期与小时的费用热力图'}
          onBlur={() => setFocus(null)} onPointerLeave={() => setHover(null)}
          onKeyDown={event => {
            const next = chartKey(event, focus ?? pinned, cells.length, calendar ? 7 : 1, calendar ? 1 : 24)
            if (next !== null) {setHover(null); setFocus(next)}
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              choose(focus ?? pinned ?? 0, event.shiftKey)
            }
            if (event.key === 'Escape' && (pinned !== null || reading !== null)) {
              event.stopPropagation()
              setPinned(null)
              setFocus(null)
              setHover(null)
            }
          }}>
          {weekdays.map((day, row) => (!calendar || row % 2 === 0) && <text className={reading !== null && rowOf(reading) === row ? 'is-highlight' : undefined}
            key={day} x={21} y={20 + row * pitch + size / 2} textAnchor="end" dominantBaseline="middle">{day}</text>)}
          {columns.map(({col, label}) => <text className={reading !== null && colOf(reading) === col ? 'is-highlight' : undefined}
            key={col} x={28 + col * pitch} y={13}>{label}</text>)}
          {cells.map((cell, index) => {
            const level = levelOf(cell)
            const outside = isDay(cell) && report && (+new Date(cell.end) <= +new Date(report.start) || +new Date(cell.start) >= +new Date(report.end))
            return <rect key={isDay(cell) ? cell.start : index} className={cn('usage-heat-cell', {
              'is-dim': outside, 'is-muted': activeLevel !== null && activeLevel !== level,
              'is-peak': peak && !isDay(cell) && cell.deepseek_peak,
              'is-marked': index === focus || index === pinned || (isDay(cell) && linkedDate === dayOf(cell.start)),
            })} width={size} height={size} rx={3} x={28 + colOf(index) * pitch} y={20 + rowOf(index) * pitch}
              fill={`var(--usage-heat-${level})`} onPointerEnter={() => setHover(index)}
              onClick={event => {
                event.currentTarget.ownerSVGElement?.focus({preventScroll: true})
                choose(index, event.shiftKey)
              }}><title>{cellTitle(cell)} · {fmt(cell.requests)} 次 · {cost(cell)}</title></rect>
          })}
        </svg>
      </div>
      <div className="usage-heat-side">
        <div aria-live="polite">{current ? <CellDetail cell={current}/> : report && <HeatSummary report={report} calendar={calendar} label={label}/>}</div>
        <div className="usage-scale" aria-label="色阶"><span>少</span>
          {Array.from({length: 5}, (_, level) => <button key={level} type="button" aria-label={level === 0 ? '无费用' : `第 ${level} 档费用`}
            style={{background: `var(--usage-heat-${level})`}} onPointerEnter={() => setActiveLevel(level)} onPointerLeave={() => setActiveLevel(null)}
            onFocus={() => setActiveLevel(level)} onBlur={() => setActiveLevel(null)}
            onClick={() => setActiveLevel(value => value === level ? null : level)}/>)}
          <span>多</span>
        </div>
      </div>
    </div>
    <p className="usage-unit usage-heat-hint">{calendar ? '点击日期查看当天，Shift 点击选一段。方向键移动，Enter 选择。' : '点击格子或按 Enter 固定明细。方向键移动，Esc 取消。'}</p>
  </section>
}
