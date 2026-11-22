import {useState, type KeyboardEvent} from 'react'

/**
 * macOS WebKit（含 Tauri WKWebView）在中文输入法组合态按回车确认英文字符上屏时，
 * 事件顺序与 Chromium 相反：先触发 compositionend，紧接着触发同一次按键的 keydown(Enter)，
 * 此时 nativeEvent.isComposing 已为 false（原生 keyCode 常为 229，部分第三方输入法为 13）。
 *
 * 组合态守卫同时处理两种顺序：
 * - Chromium 顺序（keydown 在前、compositionend 在后）：在 keydown 阶段拦截并标记已捕获，
 *   compositionend 不再武装延迟窗口，紧接着用户第二次按 Enter 立即放行。
 * - WebKit 顺序（compositionend 在前、keydown 在后）：compositionend 武装一次短窗口，
 *   紧随其后的确认 Enter 被单次消费拦截，随后第二次按 Enter 或先按空格再按 Enter 均正常放行。
 */
const POST_COMPOSITION_WINDOW_MS = 50

export type ImeKeyEvent = Pick<KeyboardEvent, 'key'> & {
  nativeEvent?: {isComposing?: boolean; keyCode?: number}
}

export function createImeGuard(now: () => number = () => performance.now()) {
  let composing = false
  let caughtDuringComposition = false
  let justEndedUntil = 0

  return {
    get isComposing() {
      return composing
    },
    onCompositionStart() {
      composing = true
      caughtDuringComposition = false
      justEndedUntil = 0
    },
    onCompositionEnd() {
      composing = false
      justEndedUntil = caughtDuringComposition ? 0 : now() + POST_COMPOSITION_WINDOW_MS
      caughtDuringComposition = false
    },
    /** 返回 true 表示这次按键属于输入法组合过程，调用方不应触发提交、发送或快捷键。 */
    isComposingKeyDown(event: ImeKeyEvent) {
      const native = event.nativeEvent
      if (native?.isComposing || composing || native?.keyCode === 229) {
        if (event.key === 'Enter' || native?.keyCode === 229) caughtDuringComposition = true
        return true
      }
      if (justEndedUntil > 0) {
        const withinWindow = now() <= justEndedUntil
        justEndedUntil = 0
        if (withinWindow && event.key === 'Enter') return true
      }
      return false
    },
    isComposingKeyUp(event: ImeKeyEvent) {
      const native = event.nativeEvent
      if (native?.isComposing || composing || native?.keyCode === 229) return true
      if (justEndedUntil > 0 && event.key !== 'Enter') justEndedUntil = 0
      return false
    },
  }
}

export function useImeComposition() {
  const [guard] = useState(() => createImeGuard())
  return guard
}
