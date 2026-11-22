/**
 * 文本区域的选区与改写。输入框、文本域与 contenteditable 共用这里的读取、恢复与插入。
 * 插入优先走 execCommand，使改动进入 WebView 的撤销栈，并让 React 受控输入收到 input 事件；不支持时回退为直接写值。
 */

export type TextField = HTMLInputElement | HTMLTextAreaElement

export type EditTarget =
  | {kind: 'text'; element: TextField; writable: boolean}
  | {kind: 'rich'; element: HTMLElement; writable: true}

const NON_TEXT_INPUTS = new Set(['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit'])

/** 找出事件目标所在的可编辑区域；禁用的控件不算。contenteditable 取最外层的编辑宿主。 */
export function editTargetOf(target: EventTarget | null): EditTarget | null {
  const element = target instanceof Element ? target : null
  if (!element) return null
  const control = element.closest('input, textarea')
  if (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement) {
    const textual = !(control instanceof HTMLInputElement) || !NON_TEXT_INPUTS.has(control.type)
    if (!textual || control.disabled) return null
    return {kind: 'text', element: control, writable: !control.readOnly}
  }
  if (element instanceof HTMLElement && element.isContentEditable) {
    let host: HTMLElement = element
    while (host.parentElement?.isContentEditable) host = host.parentElement
    return {kind: 'rich', element: host, writable: true}
  }
  return null
}

/** 当前选中的文字；无选区时为空串。 */
export function selectedTextOf(target: EditTarget): string {
  if (target.kind === 'text') {
    const {selectionStart: start, selectionEnd: end, value} = target.element
    return start != null && end != null && end > start ? value.slice(start, end) : ''
  }
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || !target.element.contains(selection.anchorNode)) return ''
  return selection.toString()
}

/** 记下当前选区，返回把焦点与选区放回原处的函数。文本区域只记起止位置，富文本记下 Range 副本。 */
export function captureSelection(target: EditTarget): () => void {
  if (target.kind === 'text') {
    const {selectionStart: start, selectionEnd: end} = target.element
    return () => {
      target.element.focus({preventScroll: true})
      try {
        if (start != null && end != null) target.element.setSelectionRange(start, end)
      } catch {/* 部分输入类型不支持选区，保留焦点即可 */}
    }
  }
  const selection = window.getSelection()
  const range = selection && selection.rangeCount > 0 && target.element.contains(selection.anchorNode)
    ? selection.getRangeAt(0).cloneRange() : null
  return () => {
    target.element.focus({preventScroll: true})
    if (!range) return
    const current = window.getSelection()
    current?.removeAllRanges()
    current?.addRange(range)
  }
}

/** 替换选区（无选区时为光标处插入）。 */
export function insertText(target: EditTarget, text: string) {
  target.element.focus({preventScroll: true})
  if (document.execCommand('insertText', false, text)) return
  if (target.kind !== 'text') throw new Error('无法在这里插入文字')
  const field = target.element
  const start = field.selectionStart ?? field.value.length
  const end = field.selectionEnd ?? start
  const next = field.value.slice(0, start) + text + field.value.slice(end)
  const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(field, next)
  field.setSelectionRange(start + text.length, start + text.length)
  field.dispatchEvent(new Event('input', {bubbles: true}))
}

export function selectAllText(target: EditTarget) {
  target.element.focus({preventScroll: true})
  if (target.kind === 'text') {
    target.element.select()
    return
  }
  const range = document.createRange()
  range.selectNodeContents(target.element)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}
