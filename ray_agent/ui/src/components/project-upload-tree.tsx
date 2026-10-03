'use client'

import {useMemo, useRef, useState} from 'react'
import {ChevronDown, ChevronRight, File, Folder, Info} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {formatBytes} from '@/components/run/format'
import {cn} from '@/lib/utils'
import type {ExcludedUpload, UploadScan} from '@/lib/project-upload'
import type {ProjectOperationResult, ProjectUploadPreflight} from '@/lib/api/types'

type Props = {scan: UploadScan; optionalRows: ExcludedUpload[]; confirmed: Set<string>; overwrite: Set<string>; preflight: ProjectUploadPreflight | null; result: ProjectOperationResult | null; onlyFailed?: Set<string>; disabled: boolean; sourceName: string; onOptional: (path: string, checked: boolean) => void; onOverwrite: (path: string, checked: boolean) => void}
type Node = {path: string; name: string; directory: boolean; children: Node[]; size: number | null; status: string; reason: string; optional?: boolean; conflict?: boolean; confirmed?: boolean}
const filters = ['全部', '将上传', '需确认', '已排除', '上传失败']

/** 审核树只改变展示；上传集合由原有扫描与确认流程决定。 */
export function ProjectUploadTree(props: Props) {
  const [filter, setFilter] = useState('全部')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [selection, setSelection] = useState<string | null>(null)
  const buttons = useRef(new Map<string, HTMLButtonElement>())
  const roots = useMemo(() => {
    const nodes = new Map<string, Node>()
    const ensure = (path: string, directory: boolean): Node => {
      const old = nodes.get(path)
      if (old) {old.directory ||= directory; return old}
      const node: Node = {path, name: path.split('/').pop()!, directory, children: [], size: directory ? 0 : null, status: '将上传', reason: ''}
      nodes.set(path, node)
      const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
      if (parent) ensure(parent, true).children.push(node)
      return node
    }
    for (const file of props.scan.files) {
      if (props.onlyFailed && !props.onlyFailed.has(file.path)) continue
      const node = ensure(file.path, false)
      node.size = file.file.size
      const item = props.preflight?.items.find(item => item.path === file.path)
      node.conflict = item?.conflict
      node.status = item?.conflict && !props.overwrite.has(file.path) ? '需确认' : '将上传'
      node.reason = item?.reuse ? '相同内容，将复用已有文件' : item?.conflict ? '项目中存在同名文件，覆盖前会保存保护快照' : '将上传文件副本'
      const failed = props.result?.results.failures?.[file.path] || props.result?.results.received?.[file.path]?.error
      if (failed) {node.status = '上传失败'; node.reason = failed}
      else if (props.result?.results.received?.[file.path]?.published) {node.status = '已上传'; node.reason = '文件已发布到项目'}
    }
    for (const item of props.optionalRows) {
      const node = ensure(item.path, item.directory)
      node.size = item.size; node.optional = item.policy === 'optional'; node.confirmed = props.confirmed.has(item.path)
      if (!['上传失败', '已上传'].includes(node.status)) node.status = node.optional ? node.confirmed && !(node.conflict && !props.overwrite.has(node.path)) ? '将上传' : '需确认' : item.reason.includes('上限') ? '超限' : '已排除'
      if (!['上传失败', '已上传'].includes(node.status)) node.reason = item.reason
    }
    const summarize = (node: Node) => {
      node.children.sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name, 'zh-CN'))
      node.children.forEach(summarize)
      if (node.directory && !node.optional && node.children.length) {
        const sizes = node.children.map(child => child.size)
        node.size = sizes.some(size => size === null) ? null : sizes.reduce<number>((sum, size) => sum + (size ?? 0), 0)
        if (node.children.some(child => child.status === '需确认')) node.status = '需确认'
        else if (node.children.some(child => child.status === '上传失败')) node.status = '上传失败'
        else if (node.children.every(child => ['已排除','超限'].includes(child.status))) node.status = '已排除'
        else if (node.children.every(child => child.status === '已上传')) node.status = '已上传'
      }
    }
    const result = [...nodes.values()].filter(node => !node.path.includes('/'))
    result.sort((a,b) => Number(b.directory)-Number(a.directory) || a.name.localeCompare(b.name, 'zh-CN')).forEach(summarize)
    return result
  }, [props.scan, props.optionalRows, props.preflight, props.overwrite, props.confirmed, props.onlyFailed, props.result])
  const matches = (node: Node): boolean => filter === '全部' || node.status === filter || (filter === '已排除' && node.status === '超限') || node.children.some(matches)
  const visible: {node: Node; level: number; parent?: string}[] = []
  const isOpen = (node: Node, level: number) => !collapsed.has(node.path) && (filter !== '全部' || level < 2 || expanded.has(node.path))
  const visit = (node: Node, level: number, parent?: string) => {
    if (!matches(node)) return
    visible.push({node, level, parent})
    if (isOpen(node, level)) node.children.forEach(child => visit(child, level + 1, node.path))
  }
  roots.forEach(node => visit(node, 1))
  const selected = visible.find(({node}) => node.path === selection)?.node ?? visible[0]?.node
  const toggle = (node: Node, level: number) => {
    if (isOpen(node, level)) setCollapsed(old => new Set(old).add(node.path))
    else {setCollapsed(old => {const next = new Set(old); next.delete(node.path); return next}); setExpanded(old => new Set(old).add(node.path))}
  }
  return <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border font-normal">
    <div className="flex shrink-0 flex-wrap gap-1 border-b bg-muted/40 p-2" role="group" aria-label="筛选导入文件">
      {filters.map(value => <Button key={value} size="sm" variant={filter === value ? 'secondary' : 'ghost'} aria-pressed={filter === value} onClick={() => {setFilter(value); setCollapsed(new Set())}}>{value}</Button>)}
    </div>
    <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(0,1fr)_240px]">
      <div className="min-h-0 overflow-y-auto overscroll-contain p-2">
        <p className="mb-2 flex items-center gap-2 px-2 text-sm font-medium"><Folder className="size-4 shrink-0"/><span className="truncate" title={props.sourceName}>{props.sourceName}</span></p>
        <div role="tree" aria-label="待导入文件树">
          {visible.map(({node, level, parent}, index) => <div key={node.path} className="flex min-w-0 items-center" style={{paddingLeft: (level - 1) * 20}}>
            {node.directory && node.children.length ? <button type="button" tabIndex={-1} className="flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`${isOpen(node, level) ? '收起' : '展开'} ${node.name}`} onClick={() => toggle(node, level)}>{isOpen(node, level) ? <ChevronDown className="size-3.5"/> : <ChevronRight className="size-3.5"/>}</button> : <span className="w-7 shrink-0"/>}
            <button type="button" role="treeitem" aria-level={level} aria-selected={selected?.path === node.path} aria-expanded={node.directory && node.children.length ? isOpen(node, level) : undefined} tabIndex={selected?.path === node.path ? 0 : -1}
              ref={element => {if(element) buttons.current.set(node.path, element); else buttons.current.delete(node.path)}} onClick={() => setSelection(node.path)}
              onKeyDown={event => {
                const focus = (path?: string) => {if(path) {setSelection(path); buttons.current.get(path)?.focus()}}
                if (['ArrowDown','ArrowUp','Home','End','ArrowRight','ArrowLeft'].includes(event.key)) event.preventDefault()
                if(event.key === 'ArrowDown') focus(visible[index+1]?.node.path)
                if(event.key === 'ArrowUp') focus(visible[index-1]?.node.path)
                if(event.key === 'Home') focus(visible[0]?.node.path)
                if(event.key === 'End') focus(visible.at(-1)?.node.path)
                if(event.key === 'ArrowRight' && node.children.length) {if(!isOpen(node,level)) toggle(node,level); else focus(visible[index+1]?.node.path)}
                if(event.key === 'ArrowLeft') {if(node.children.length && isOpen(node,level)) toggle(node,level); else focus(parent)}
              }}
              className={cn('flex min-h-8 min-w-0 flex-1 items-center gap-2 rounded px-2 text-left text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring', selected?.path === node.path && 'bg-muted')}>
              {node.directory ? <Folder className="size-4 shrink-0 text-muted-foreground"/> : <File className="size-4 shrink-0 text-muted-foreground"/>}
              <span className="min-w-0 flex-1 truncate" title={node.name}>{node.name}</span>
              <span className={cn('shrink-0 text-xs', ['需确认','超限'].includes(node.status) ? 'text-state-waiting' : node.status === '上传失败' ? 'text-state-failed' : 'text-muted-foreground')}>{node.status}</span>
              <span className="hidden w-16 shrink-0 text-right text-xs tabular-nums text-muted-foreground sm:inline">{node.size === null ? '未统计' : formatBytes(node.size)}</span>
            </button>
          </div>)}
          {!visible.length && <p className="p-4 text-meta text-faint">没有符合筛选条件的文件</p>}
        </div>
      </div>
      {selected && <aside aria-label="所选文件详情" className="max-h-44 overflow-y-auto border-t bg-muted/20 p-3 text-meta md:max-h-none md:border-t-0 md:border-l">
        <p className="mb-3 flex items-center gap-2 font-medium"><Info className="size-4"/>文件详情</p>
        <p className="break-all font-mono text-xs">{selected.path}</p>
        <p className="mt-3">{selected.status} · {selected.size === null ? '未扫描，大小未统计' : formatBytes(selected.size)}</p>
        <p className="mt-2 text-muted-foreground">{selected.reason || '包含将导入的文件；空文件夹不会保留'}</p>
        {selected.optional && <label className="mt-4 flex items-start gap-2"><input type="checkbox" className="mt-1" disabled={props.disabled} checked={props.confirmed.has(selected.path)} onChange={event => props.onOptional(selected.path,event.target.checked)}/>确认上传此{selected.directory ? '文件夹，继续扫描' : '文件'}</label>}
        {selected.conflict && <label className="mt-4 flex items-start gap-2"><input type="checkbox" className="mt-1" disabled={props.disabled} checked={props.overwrite.has(selected.path)} onChange={event => props.onOverwrite(selected.path,event.target.checked)}/>确认覆盖同名文件</label>}
      </aside>}
    </div>
  </div>
}
