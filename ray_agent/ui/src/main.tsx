import {StrictMode} from 'react'
import {createRoot} from 'react-dom/client'
import {App} from '@/app'
import {routeExternalLinks} from '@/lib/external-links'
import {FONT_SIZE_BASE, readFontSize} from '@/lib/font-size'
import {isDesktop} from '@/lib/platform'
import './globals.css'

document.documentElement.style.setProperty('--font-scale', String(readFontSize() / FONT_SIZE_BASE))
if (isDesktop()) routeExternalLinks()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App/>
  </StrictMode>,
)
