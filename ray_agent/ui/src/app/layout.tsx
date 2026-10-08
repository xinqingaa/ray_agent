import React from 'react'
import type {Metadata} from 'next'
import {ThemeProvider} from 'next-themes'
import {Toaster} from '@/components/ui/sonner'
import {AppShell} from '@/components/app-shell'
import {FONT_SIZE_BOOT_SCRIPT} from '@/lib/font-size'
import '@fontsource-variable/ibm-plex-sans/wght.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import './globals.css'

export const metadata: Metadata = {
  title: 'RayAgent',
  description: 'RayAgent 在沙箱中操作文件、终端和浏览器，按你的任务一步步执行并交付结果。',
  icons: {
    icon: '/brand-mark.svg',
  },
}

export default function RootLayout(
  {
    children,
  }: Readonly<{
    children: React.ReactNode;
  }>,
) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
    <head>
      <script dangerouslySetInnerHTML={{__html: FONT_SIZE_BOOT_SCRIPT}}/>
    </head>
    <body className="h-screen overflow-hidden">
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <AppShell>
        {children}
      </AppShell>
      <Toaster position="top-center" richColors/>
    </ThemeProvider>
    </body>
    </html>
  )
}
