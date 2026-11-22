import {StrictMode} from 'react'
import {createRoot} from 'react-dom/client'
import {App} from '@/app'
import {ContextMenuProvider} from '@/components/ui/context-menu'
import {routeExternalLinks} from '@/lib/external-links'
import {FONT_SIZE_BASE, readFontSize} from '@/lib/font-size'
import {isDesktop} from '@/lib/platform'
import './globals.css'

document.documentElement.style.setProperty('--font-scale', String(readFontSize() / FONT_SIZE_BASE))
if (isDesktop()) routeExternalLinks()

// A file dropped outside an upload target must not navigate the WebView away from the app.
const preventFileNavigation = (event: DragEvent) => {
  if (event.dataTransfer && Array.from(event.dataTransfer.types).includes('Files')) event.preventDefault()
}
window.addEventListener('dragover', preventFileNavigation)
window.addEventListener('drop', preventFileNavigation)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ContextMenuProvider>
      <App/>
    </ContextMenuProvider>
  </StrictMode>,
)
