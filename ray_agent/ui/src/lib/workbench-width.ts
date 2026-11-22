export const WORKBENCH_WIDTH_KEY = 'rayagent.workbenchWidth'
export const WORKBENCH_DEFAULT_PX = 320
const WORKBENCH_WIDE_PX = 400

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

/**
 * 预设档位：紧凑（下限）、标准（默认）、较宽，以及最宽（当前上限）。
 * 四档首尾覆盖拖动范围；窗口变窄时超出上限的档位隐藏，相同宽度只保留一档。
 */
export function workbenchPresets(viewportWidth: number) {
  const {min, max} = workbenchBounds(viewportWidth)
  const items = [
    {id: 'compact', label: '紧凑', px: min},
    {id: 'standard', label: '标准', px: WORKBENCH_DEFAULT_PX},
    {id: 'wide', label: '较宽', px: WORKBENCH_WIDE_PX},
    {id: 'widest', label: '最宽', px: max},
  ]
  return items.filter((item, index) => item.px >= min && item.px <= max
    && items.findIndex(other => other.px === item.px) === index)
}
