export const FONT_SIZE_KEY = 'rayagent:font-size'
/** 比例 1 对应改动前的 14px 阅读字号 */
export const FONT_SIZE_BASE = 14
export const FONT_SIZE_MIN = 14
export const FONT_SIZE_MAX = 20
export const FONT_SIZE_DEFAULT = 14

export const FONT_SIZE_PRESETS = [
  {id: '14', label: '标准（14）'},
  {id: '16', label: '较大（16）'},
  {id: '18', label: '更大（18）'},
  {id: '20', label: '最大（20）'},
] as const

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

export function fontSizeOptions(size: number): {id: string; label: string}[] {
  const presets = FONT_SIZE_PRESETS.map(item => ({id: item.id, label: item.label}))
  const id = String(size)
  if (presets.some(item => item.id === id)) return presets
  return [...presets, {id, label: id}].sort((a, b) => Number(a.id) - Number(b.id))
}

/** 首屏绘制前写上比例，避免先按默认字号画一帧再跳大 */
export const FONT_SIZE_BOOT_SCRIPT = `(function(){try{var n=Number(localStorage.getItem(${JSON.stringify(FONT_SIZE_KEY)}));if(Number.isInteger(n)&&n>=${FONT_SIZE_MIN}&&n<=${FONT_SIZE_MAX})document.documentElement.style.setProperty("--font-scale",String(n/${FONT_SIZE_BASE}))}catch(e){}})();`
