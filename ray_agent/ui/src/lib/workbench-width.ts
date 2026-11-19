export const WORKBENCH_WIDTH_KEY = 'rayagent.workbenchWidth'
export const WORKBENCH_DEFAULT_PX = 320

export function workbenchBounds(viewportWidth: number) {
  const min = 260
  const max = Math.max(min, Math.min(560, viewportWidth - 56))
  return {min, max}
}

export function clampWorkbenchWidth(px: number, viewportWidth: number) {
  const {min, max} = workbenchBounds(viewportWidth)
  if (!Number.isFinite(px)) return Math.min(max, WORKBENCH_DEFAULT_PX)
  return Math.min(max, Math.max(min, px))
}

export function readWorkbenchWidth(stored: string | null, viewportWidth: number) {
  const parsed = stored == null || stored === '' ? Number.NaN : Number(stored)
  return clampWorkbenchWidth(Number.isFinite(parsed) && parsed > 0 ? parsed : WORKBENCH_DEFAULT_PX, viewportWidth)
}
