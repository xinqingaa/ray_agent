export const FONT_SIZE_KEY = 'rayagent:font-size'
/** 比例 1 对应改动前的 14px 阅读字号 */
export const FONT_SIZE_BASE = 14
export const FONT_SIZE_MIN = 14
export const FONT_SIZE_MAX = 20
export const FONT_SIZE_DEFAULT = 14

/** 滑杆的刻度：允许范围内的每个整数。 */
export const FONT_SIZE_STEPS: readonly {id: string}[] = Array.from(
  {length: FONT_SIZE_MAX - FONT_SIZE_MIN + 1},
  (_, index) => ({id: String(FONT_SIZE_MIN + index)}),
)

export function acceptedFontSize(value: number): number | null {
  if (!Number.isInteger(value) || value < FONT_SIZE_MIN || value > FONT_SIZE_MAX) return null
  return value
}

export function readFontSize(): number {
  try {
    const raw = window.localStorage.getItem(FONT_SIZE_KEY)
    if (raw == null || raw === '') return FONT_SIZE_DEFAULT
    return acceptedFontSize(Number(raw)) ?? FONT_SIZE_DEFAULT
  } catch {
    return FONT_SIZE_DEFAULT
  }
}

export function applyFontSize(size: number): void {
  document.documentElement.style.setProperty('--font-scale', String(size / FONT_SIZE_BASE))
  try {
    window.localStorage.setItem(FONT_SIZE_KEY, String(size))
  } catch {
    /* 偏好写不进时，当前页面仍然立即使用这个字号 */
  }
}
