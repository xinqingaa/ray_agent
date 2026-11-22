import {isDesktop, readClipboardText as readHostText, writeClipboardText as writeHostText} from '@/lib/platform'

/**
 * 界面统一的剪贴板入口。桌面窗口走宿主（系统剪贴板，不受 WebView 权限提示影响）；
 * 普通浏览器开发模式回退到 navigator.clipboard。失败时抛出带中文说明的 Error，由调用方提示。
 */
export async function copyText(text: string): Promise<void> {
  try {
    if (isDesktop()) await writeHostText(text)
    else if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text)
    else throw new Error('当前环境不支持剪贴板')
  } catch {
    throw new Error('复制失败，请重试')
  }
}

export async function readClipboard(): Promise<string> {
  try {
    if (isDesktop()) return await readHostText()
    if (navigator.clipboard?.readText) return await navigator.clipboard.readText()
    throw new Error('当前环境不支持读取剪贴板')
  } catch {
    throw new Error('无法读取剪贴板里的文字，请重试')
  }
}
