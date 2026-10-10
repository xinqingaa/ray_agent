'use client'

import type {ReactNode} from 'react'
import {RefreshCw, X} from 'lucide-react'
import {IconAction} from './icon-action'

/** 标题与操作属于同一固定行；滚动区由调用容器放在其后。 */
export function OverlayToolbar({title, onRefresh, refreshLabel = '刷新', refreshing, onClose, closeLabel = '关闭'}: {title: ReactNode; onRefresh?: () => void; refreshLabel?: string; refreshing?: boolean; onClose?: () => void; closeLabel?: string}) {
  return <header className="flex shrink-0 items-center gap-2 border-b px-4 py-3 sm:px-5">
    <div className="min-w-0 flex-1">{title}</div>
    <div className="flex shrink-0 items-center gap-1">
      {onRefresh && <IconAction label={refreshLabel} disabled={refreshing} onClick={onRefresh}><RefreshCw/></IconAction>}
      {onClose && <IconAction label={closeLabel} onClick={onClose}><X/></IconAction>}
    </div>
  </header>
}
