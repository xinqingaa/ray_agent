import {useRef, useState} from 'react'
import {Button} from '@/components/ui/button'
import {ChevronLeft, ChevronRight, Clock3} from '@/components/ui/icons'
import {Popover, PopoverContent, PopoverTrigger} from '@/components/ui/popover'
import {cn} from '@/lib/utils'
import {customParts, dayLabel, localDate, pad, rangeLabel, selectedRange, wallDate, weekdays, type Range} from './usage-format'

export function UsageRangePicker({range, first, last, onApply}: {
  range: Range; first: string; last: string; onApply: (range: Range) => void
}) {
  const [open, setOpen] = useState(false)
  const [month, setMonth] = useState(last.slice(0, 7))
  const [from, setFrom] = useState(last)
  const [to, setTo] = useState(last)
  const [anchor, setAnchor] = useState<string | null>(null)
  const [hourly, setHourly] = useState(false)
  const [startHour, setStartHour] = useState(0)
  const [endHour, setEndHour] = useState(24)
  const calendar = useRef<HTMLDivElement>(null)
  const moveMonth = (offset: number) => {
    const date = localDate(month + '-01')
    date.setMonth(date.getMonth() + offset)
    return wallDate(date).slice(0, 7)
  }
  const year = Number(month.slice(0, 4))
  const monthNumber = Number(month.slice(5))
  const firstOfMonth = localDate(month + '-01')
  const offset = (firstOfMonth.getDay() + 6) % 7
  const rangeStart = localDate(from, hourly ? startHour : 0)
  const rangeEnd = localDate(to, hourly ? endHour : 24)
  const valid = +rangeEnd > +rangeStart && +rangeStart <= Date.now()
  const draft = valid ? selectedRange(from, to, hourly ? startHour : 0, hourly ? endHour : 24, hourly) : null

  const choose = (day: string) => {
    if (!anchor) {
      setFrom(day)
      setTo(day)
      setAnchor(day)
    } else {
      const [start, end] = [anchor, day].sort()
      setFrom(start)
      setTo(end)
      setAnchor(null)
    }
  }

  return <Popover open={open} onOpenChange={next => {
    if (next) {
      const parts = range.range_id === 'custom' ? customParts(range) : {from: last, to: last, startHour: 0, endHour: 24}
      setFrom(parts.from)
      setTo(parts.to)
      setMonth(parts.to.slice(0, 7))
      setStartHour(parts.startHour)
      setEndHour(parts.endHour)
      setHourly(range.range_id === 'custom' && !!range.hourly)
      setAnchor(null)
    }
    setOpen(next)
  }}>
    <PopoverTrigger asChild>
      <button type="button" className="usage-segment-button usage-custom-trigger" aria-pressed={range.range_id === 'custom'} disabled={!first}
        title={range.range_id === 'custom' ? rangeLabel(range) : '自定义时段'}>
        <Clock3 className="size-3.5 shrink-0" aria-hidden/>
        <span>{range.range_id === 'custom' ? rangeLabel(range, true) : '自定义'}</span>
      </button>
    </PopoverTrigger>
    <PopoverContent className="usage-picker" align="end" sideOffset={8} aria-label="自定义时段"
      onOpenAutoFocus={event => {
        event.preventDefault()
        calendar.current?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')?.focus({preventScroll: true})
      }}>
      <div className="usage-picker-head">
        <Button type="button" variant="ghost" size="icon-sm" aria-label="上个月"
          disabled={moveMonth(-1) < first.slice(0, 7)} onClick={() => setMonth(moveMonth(-1))}><ChevronLeft/></Button>
        <strong aria-live="polite">{year} 年 {monthNumber} 月</strong>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="下个月"
          disabled={moveMonth(1) > last.slice(0, 7)} onClick={() => setMonth(moveMonth(1))}><ChevronRight/></Button>
      </div>
      <div className="usage-picker-grid" ref={calendar}>
        {weekdays.map(day => <span key={day}>{day}</span>)}
        {Array.from({length: 42}, (_, index) => {
          const date = new Date(firstOfMonth)
          date.setDate(index - offset + 1)
          const day = wallDate(date)
          if (date.getMonth() + 1 !== monthNumber) return <span key={day}/>
          const edge = day === from || day === to
          return <button key={day} type="button" data-day={day} aria-label={dayLabel(day)} aria-pressed={edge}
            aria-current={day === last ? 'date' : undefined} disabled={day < first || day > last}
            className={cn('usage-picker-day', { 'is-between': day > from && day < to, 'is-edge': edge})}
            onClick={() => choose(day)} onKeyDown={event => {
              const steps: Record<string, number> = {ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7}
              const step = steps[event.key]
              if (!step) return
              event.preventDefault()
              const nextDate = new Date(date)
              nextDate.setDate(nextDate.getDate() + step)
              const next = wallDate(nextDate)
              if (next < first || next > last) return
              if (next.slice(0, 7) !== month) setMonth(next.slice(0, 7))
              requestAnimationFrame(() => calendar.current?.querySelector<HTMLButtonElement>(`[data-day="${next}"]`)?.focus({preventScroll: true}))
            }}>{date.getDate()}</button>
        })}
      </div>
      <div className="usage-picker-time">
        <select aria-label="开始小时" value={hourly ? startHour : 0} disabled={!hourly} onChange={event => setStartHour(+event.target.value)}>
          {Array.from({length: 24}, (_, hour) => <option key={hour} value={hour}>{pad(hour)}:00</option>)}
        </select>
        <span>–</span>
        <select aria-label="结束小时" value={hourly ? endHour : 24} disabled={!hourly} onChange={event => setEndHour(+event.target.value)}>
          {Array.from({length: 25}, (_, hour) => <option key={hour} value={hour}>{pad(hour)}:00</option>)}
        </select>
        <div className="usage-segment" role="group" aria-label="时段精度">
          <button type="button" className="usage-segment-button" aria-pressed={!hourly} onClick={() => setHourly(false)}>全天</button>
          <button type="button" className="usage-segment-button" aria-pressed={hourly} onClick={() => setHourly(true)}>按小时</button>
        </div>
      </div>
      <div className="usage-picker-foot">
        <span className="usage-unit">{draft ? rangeLabel(draft) : '请选择有效时段'}</span>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>取消</Button>
        <Button type="button" size="sm" disabled={!draft} onClick={() => {
          if (draft) onApply(draft)
          setOpen(false)
        }}>应用</Button>
      </div>
    </PopoverContent>
  </Popover>
}
