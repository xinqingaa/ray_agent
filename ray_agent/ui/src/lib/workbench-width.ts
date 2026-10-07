export const WORKBENCH_WIDTH_KEY = 'rayagent.workbenchWidth'
export const WORKBENCH_DEFAULT_PX = 26 * 16

export function workbenchBounds(viewportWidth: number) {
  const min = 24 * 16
  const max = Math.max(min, viewportWidth * 0.6)
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
