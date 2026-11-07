import type {MemoryType} from '@/lib/api/types'

export const MEMORY_TYPE_LABEL: Record<MemoryType, string> = {
  fact: '事实',
  preference: '偏好',
  decision: '决定',
  constraint: '约束',
}

export const MEMORY_TYPE_OPTIONS: {value: MemoryType; label: string}[] = (
  Object.entries(MEMORY_TYPE_LABEL) as [MemoryType, string][]
).map(([value, label]) => ({value, label}))
