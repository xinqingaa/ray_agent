import {openExternal} from '@/lib/platform'

/** 应用窗口不打开新窗口或离开应用；指向其他来源的链接交给系统浏览器。应用内路由链接由路由自己处理。 */
export function routeExternalLinks() {
  const onClick = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button > 1) return
    const anchor = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
    if (!anchor) return
    const url = new URL(anchor.href, window.location.href)
    if (url.origin === window.location.origin) return
    event.preventDefault()
    if (/^(https?|mailto):$/.test(url.protocol)) void openExternal(url.href)
  }
  document.addEventListener('click', onClick)
  document.addEventListener('auxclick', onClick)
  return () => {
    document.removeEventListener('click', onClick)
    document.removeEventListener('auxclick', onClick)
  }
}
