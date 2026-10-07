import type {TimelineItem} from '@/lib/session-view'

type ProcessItem = Extract<TimelineItem, {kind: 'narration' | 'tools'}>

export type ProcessBlock = {
  id: string
  runId: string | null
  turnIndex: number | null
  items: ProcessItem[]
}

export type TimelineRow =
  | {type: 'item'; item: TimelineItem}
  | {type: 'process'; block: ProcessBlock}

export function groupProcessBlocks(items: TimelineItem[]): TimelineRow[] {
  const rows: TimelineRow[] = []
  let index = 0
  while (index < items.length) {
    const item = items[index]
    if (item.kind !== 'narration' && item.kind !== 'tools') {
      rows.push({type: 'item', item})
      index += 1
      continue
    }
    const chunk: ProcessItem[] = []
    const runId = item.runId
    while (index < items.length) {
      const next = items[index]
      if ((next.kind !== 'narration' && next.kind !== 'tools') || next.runId !== runId) break
      chunk.push(next)
      index += 1
    }
    for (const block of splitChunk(chunk)) rows.push({type: 'process', block})
  }
  return rows
}

function splitChunk(chunk: ProcessItem[]): ProcessBlock[] {
  const turns: Array<number | null> = chunk.map(item => item.kind === 'tools' ? item.turnIndex : item.turnIndex ?? null)
  for (let i = 0; i < chunk.length; i++) {
    const item = chunk[i]
    if (item.kind !== 'narration' || item.turnIndex != null) continue
    let found: number | null = null
    for (let j = i + 1; j < chunk.length; j++) {
      const next = chunk[j]
      if (next.kind === 'tools') {found = next.turnIndex; break}
      if (next.kind === 'narration' && next.turnIndex != null) {found = next.turnIndex; break}
    }
    if (found == null) {
      for (let j = i - 1; j >= 0; j--) {
        if (turns[j] != null) {found = turns[j]; break}
      }
    }
    turns[i] = found
  }
  const blocks: ProcessBlock[] = []
  for (let i = 0; i < chunk.length; i++) {
    const turn = turns[i]
    const last = blocks[blocks.length - 1]
    if (last && last.turnIndex === turn) last.items.push(chunk[i])
    else blocks.push({id: chunk[i].id, runId: chunk[i].runId, turnIndex: turn, items: [chunk[i]]})
  }
  return blocks
}

export function processSettled(items: TimelineItem[], block: ProcessBlock): boolean {
  const lastId = block.items[block.items.length - 1]?.id
  const index = items.findIndex(item => item.id === lastId)
  const rest = index < 0 ? [] : items.slice(index + 1)
  return rest.some(item => item.runId === block.runId && (item.kind === 'final' || item.kind === 'run_end'))
}

export function processBlockOpen(settled: boolean, override: boolean | null, streaming: boolean): boolean {
  if (streaming) return true
  return override ?? !settled
}

export function processSummary(block: ProcessBlock): string {
  const calls = block.items.flatMap(item => item.kind === 'tools' ? item.calls : [])
  const narration = block.items.find(item => item.kind === 'narration')
  const line = narration?.kind === 'narration'
    ? narration.text.split('\n').map(part => part.trim()).find(Boolean) ?? ''
    : ''
  const clipped = line.length > 42 ? `${line.slice(0, 42)}…` : line
  const verbs = [...new Set(calls.map(call => call.verb).filter(Boolean))].slice(0, 3)
  const parts = [
    block.turnIndex != null ? `第 ${block.turnIndex} 轮` : '过程',
    calls.length > 0 ? `${calls.length} 个工具` : '',
    verbs.join('、'),
    clipped,
  ].filter(Boolean)
  return parts.join(' · ')
}
