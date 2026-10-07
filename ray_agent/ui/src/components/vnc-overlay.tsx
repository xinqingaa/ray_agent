'use client'

import { useEffect, useMemo, useCallback, useState } from 'react'
import dynamic from 'next/dynamic'
import { X, Loader2, WifiOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { VNCStatus } from '@/components/vnc-viewer'

const VNCViewer = dynamic(
  () => import('@/components/vnc-viewer').then((m) => ({ default: m.VNCViewer })),
  { ssr: false },
)

export interface VNCOverlayProps {
  sessionId: string
  onClose: () => void
}

function buildVNCUrl(sessionId: string): string {
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000/api'

  let host: string
  let pathname: string
  let isHttps: boolean

  try {
    const url = new URL(apiBase)
    host = url.host
    pathname = url.pathname
    isHttps = url.protocol === 'https:'
  } catch {
    host = window.location.host
    pathname = apiBase
    isHttps = window.location.protocol === 'https:'
  }

  const protocol = isHttps ? 'wss:' : 'ws:'
  return `${protocol}//${host}${pathname}/sessions/${sessionId}/vnc`
}

export function VNCOverlay({ sessionId, onClose }: VNCOverlayProps) {
  const vncUrl = useMemo(() => buildVNCUrl(sessionId), [sessionId])
  const [status, setStatus] = useState<VNCStatus>('connecting')
  const [errorDetail, setErrorDetail] = useState('')

  const handleStatusChange = useCallback((s: VNCStatus, detail?: string) => {
    setStatus(s)
    if (s === 'error' || s === 'disconnected') {
      setErrorDetail(detail || '连接失败')
    }
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = ''
    }
  }, [onClose])

  const hasError = status === 'error' || status === 'disconnected'

  return (
    <div className="dark fixed inset-0 z-50 flex flex-col bg-background animate-in fade-in duration-200">
      <div className="relative flex-1">
        <VNCViewer url={vncUrl} viewOnly={false} onStatusChange={handleStatusChange} />

        {status === 'connecting' && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-background/80">
            <Loader2 className="size-8 animate-spin text-foreground" />
            <span className="text-sm text-muted-foreground">正在连接沙箱环境...</span>
          </div>
        )}

        {hasError && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-background/80">
            <div className="flex flex-col items-center gap-3 rounded-lg border bg-card px-10 py-8">
              <WifiOff className="size-10 text-muted-foreground" />
              <div className="text-base font-medium text-foreground">无法连接到沙箱</div>
              <p className="max-w-[280px] text-center text-sm leading-relaxed text-muted-foreground">
                {errorDetail || '沙箱环境可能已关闭，请确认任务仍在运行中'}
              </p>
              <Button variant="secondary" onClick={onClose} className="mt-2">
                <X size={14} />
                退出远程桌面
              </Button>
            </div>
          </div>
        )}
      </div>

      {status === 'connected' && (
        <div className="absolute bottom-6 left-1/2 z-10 -translate-x-1/2">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-2 rounded-md border bg-card/80 px-5 py-2 text-sm text-foreground"
          >
            <X size={14} />
            退出远程桌面
          </button>
        </div>
      )}
    </div>
  )
}
