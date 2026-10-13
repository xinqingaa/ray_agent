import type {ModelCatalog} from '@/lib/api/types'
import type {ModelSelection} from './model-selection'

const KEY = 'rayagent:recent-model'
export const MODEL_PREFERENCE_CHANGED = 'rayagent-model-preference-changed'
let fallback: ModelSelection | null = null

export function readModelPreference(): ModelSelection | null {
  if (typeof window === 'undefined') return null
  try {
    const value = JSON.parse(window.localStorage.getItem(KEY) ?? 'null')
    return value?.version === 1 && typeof value.model === 'string' && typeof value.reasoning === 'string'
      ? {model: value.model, reasoning: value.reasoning} : null
  } catch {return fallback}
}

export function rememberModelPreference(selection: ModelSelection): void {
  fallback = selection
  if (typeof window === 'undefined') return
  try {window.localStorage.setItem(KEY, JSON.stringify({version: 1, ...selection}))} catch {}
  window.dispatchEvent(new Event(MODEL_PREFERENCE_CHANGED))
}

export function validModelPreference(preference: ModelSelection | null, catalog: ModelCatalog): ModelSelection | null {
  const model = catalog.models.find(item => item.id === preference?.model)
    ?? catalog.models.find(item => item.id === catalog.default_model) ?? catalog.models[0]
  if (!model) return null
  return {model: model.id, reasoning: preference?.model === model.id && model.choices.includes(preference.reasoning)
    ? preference.reasoning : model.default_choice}
}
