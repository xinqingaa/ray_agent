'use client'

import {useSyncExternalStore} from 'react'

const STORAGE_KEY = 'rayagent:developer-mode'
const CHANGE_EVENT = 'rayagent:developer-mode-changed'
let memoryOverride: boolean | null = null

/** 显隐策略集中在这里；后续调整单个区域，无需改动执行或事件契约。 */
export function createDeveloperVisibility(enabled: boolean) {
  const regions = {
    developerView: enabled,
    toolDetails: enabled,
    toolMetrics: enabled,
    toolCounts: enabled,
    contextUsage: enabled,
    requestMetrics: enabled,
    manualCompaction: enabled,
    terminal: enabled,
    rawResults: enabled,
    projectPaths: enabled,
    executionSettings: enabled,
    providerSettings: enabled,
    connectionSettings: enabled,
    memoryInternals: enabled,
    reasoningInTrigger: enabled,
  }
  return {
    ...regions,
    canInspectTool: (family: string) => family === 'shell' ? regions.terminal : regions.rawResults || ['browser', 'file', 'deliver'].includes(family),
    canShowWorkbenchTab: (tab: string) => tab === 'terminal' ? regions.terminal : tab !== 'result' || regions.rawResults,
    canShowCommand: (id: string) => id !== 'compact' || regions.manualCompaction,
  }
}

const ordinaryVisibility = createDeveloperVisibility(false)
const developerVisibility = createDeveloperVisibility(true)

function snapshot() {
  if (memoryOverride != null) return memoryOverride
  try {return window.localStorage.getItem(STORAGE_KEY) === 'true'} catch {return false}
}

function subscribe(callback: () => void) {
  if (typeof window === 'undefined') return () => {}
  const storage = (event: StorageEvent) => {if (event.key === STORAGE_KEY || event.key == null) {memoryOverride = null; callback()}}
  window.addEventListener(CHANGE_EVENT, callback)
  window.addEventListener('storage', storage)
  return () => {window.removeEventListener(CHANGE_EVENT, callback); window.removeEventListener('storage', storage)}
}

export function setDeveloperMode(enabled: boolean) {
  try {window.localStorage.setItem(STORAGE_KEY, String(enabled)); memoryOverride = null} catch {memoryOverride = enabled}
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

export function useDeveloperMode() {
  const enabled = useSyncExternalStore(subscribe, snapshot, () => false)
  return {enabled, setEnabled: setDeveloperMode, visibility: enabled ? developerVisibility : ordinaryVisibility}
}
