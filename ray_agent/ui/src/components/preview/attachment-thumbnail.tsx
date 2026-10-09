'use client'

/* eslint-disable @next/next/no-img-element -- 图片已由预览服务压缩，直接使用其缩略图。 */

import {useEffect, useRef, useState} from 'react'
import {ApiError} from '@/lib/api/fetch'
import {previewContentUrl, previewEndpoint, readPreview} from '@/lib/api/preview'

/** 复用有资源限制的图片预览，只读取进入阅读区域的附件。 */
export function AttachmentThumbnail({id, filename}: {id: string; filename: string}) {
  const container = useRef<HTMLDivElement>(null)
  const [src, setSrc] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    const source = {kind: 'attachment' as const, id, filename}
    const load = () => {
      void readPreview(previewEndpoint(source), new URLSearchParams(), controller.signal).then(preview => {
        if (controller.signal.aborted) return
        if (preview.kind !== 'image') throw new Error(preview.reason || '图片无法预览')
        setSrc(preview.thumbnail || previewContentUrl(source, preview.revision))
      }).catch(error => {
        if (!controller.signal.aborted) setError(error instanceof ApiError && error.code === 410 ? '图片已过期' : '图片加载失败')
      })
    }
    let observer: IntersectionObserver | undefined
    if (typeof IntersectionObserver === 'undefined') load()
    else {
      observer = new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting)) {
          observer?.disconnect()
          load()
        }
      }, {rootMargin: '200px'})
      if (container.current) observer.observe(container.current)
    }
    return () => {observer?.disconnect(); controller.abort()}
  }, [id, filename])

  return <div ref={container} className="pointer-events-none relative flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted shadow-sm">
    {error ? <span className="px-2 text-center text-xs text-muted-foreground">{error}</span>
      : src ? <img src={src} alt="图片预览" loading="lazy" decoding="async" className="h-full w-full object-cover object-left-top" onError={() => setError('图片加载失败')}/>
        : <span className="px-2 text-center text-xs text-muted-foreground">正在加载图片</span>}
  </div>
}
