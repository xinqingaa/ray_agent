'use client'

import {useCallback, useEffect, useState} from 'react'
import {ChevronLeft, ChevronRight, FolderGit2, Loader2} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {Popover, PopoverContent, PopoverTrigger} from '@/components/ui/popover'
import {ScrollArea} from '@/components/ui/scroll-area'
import {projectApi} from '@/lib/api/project'
import type {BrowseListing, ProjectView} from '@/lib/api/types'
import {cn} from '@/lib/utils'
import {toast} from 'sonner'

type ProjectPickerProps = {
  enabled: boolean
  selected: ProjectView | null
  onSelect: (project: ProjectView | null) => void
  open?: boolean
  onOpenChange?: (open: boolean) => void
  disabled?: boolean
  className?: string
}

type Panel = 'main' | 'browse'

export function ProjectPicker({
  enabled,
  selected,
  onSelect,
  open: controlledOpen,
  onOpenChange,
  disabled = false,
  className,
}: ProjectPickerProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const open = controlledOpen ?? internalOpen
  const setOpen = onOpenChange ?? setInternalOpen
  const [panel, setPanel] = useState<Panel>('main')
  const [loading, setLoading] = useState(false)
  const [recent, setRecent] = useState<ProjectView[]>([])
  const [browse, setBrowse] = useState<BrowseListing | null>(null)

  const loadMain = useCallback(async () => {
    setLoading(true)
    try {
      const items = await projectApi.getRecent(10)
      setRecent(items)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '读取最近项目失败')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadBrowse = useCallback(async (path: string) => {
    setLoading(true)
    try {
      const listing = await projectApi.browse(path)
      setBrowse(listing)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '浏览目录失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!open || !enabled) return
    setPanel('main')
    setBrowse(null)
    void loadMain()
  }, [open, enabled, loadMain])

  const pick = (project: ProjectView) => {
    onSelect(project)
    setOpen(false)
  }

  const startBrowse = async () => {
    setPanel('browse')
    setLoading(true)
    try {
      const roots = await projectApi.getRoots()
      if (roots.roots.length === 0) {
        toast.message('没有可用的项目根目录')
        setPanel('main')
        return
      }
      setBrowse({
        path: '',
        root: '',
        parent: null,
        is_git_repo: false,
        entries: roots.roots.map((root) => {
          const name = root.path.split('/').filter(Boolean).pop() ?? root.path
          return {name, path: root.path, is_git_repo: false, is_symlink: false}
        }),
        total: roots.roots.length,
        truncated: false,
        limit: 1000,
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '无法打开浏览')
      setPanel('main')
    } finally {
      setLoading(false)
    }
  }

  if (!enabled) return null

  const label = selected?.name ?? '选择项目'

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          className={cn('h-7 max-w-[12rem] gap-1.5 px-2 text-xs font-medium', className)}
          title={selected?.path ?? '选择要绑定的项目目录'}
        >
          <FolderGit2 className="size-3.5 shrink-0" aria-hidden/>
          <span className="truncate">{label}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" sideOffset={8} className="w-[min(22rem,calc(100vw-2rem))] p-0">
        {panel === 'main' ? (
          <div className="flex flex-col">
            <div className="border-b px-3 py-2 text-xs font-medium text-muted-foreground">最近项目</div>
            <ScrollArea className="max-h-56">
              {loading ? (
                <p className="flex items-center gap-2 px-3 py-6 text-meta text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" aria-hidden/>
                  正在读取
                </p>
              ) : recent.length === 0 ? (
                <p className="px-3 py-6 text-center text-meta text-faint">还没有最近项目</p>
              ) : (
                <ul className="p-1">
                  {recent.map((item) => (
                    <li key={item.path}>
                      <button
                        type="button"
                        disabled={!item.available}
                        title={item.available ? item.path : item.reason ?? item.path}
                        onClick={() => pick(item)}
                        className={cn(
                          'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring',
                          !item.available && 'cursor-not-allowed opacity-60',
                        )}
                      >
                        <FolderGit2 className="size-4 shrink-0 text-muted-foreground" aria-hidden/>
                        <span className="min-w-0 flex-1 truncate">{item.name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </ScrollArea>
            <div className="border-t p-2">
              <Button type="button" variant="ghost" size="sm" className="w-full justify-between" onClick={() => void startBrowse()}>
                浏览目录…
                <ChevronRight className="size-4" aria-hidden/>
              </Button>
              {selected && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="mt-1 w-full text-muted-foreground"
                  onClick={() => {
                    onSelect(null)
                    setOpen(false)
                  }}
                >
                  清除选择
                </Button>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-col">
            <div className="flex items-center gap-1 border-b px-2 py-1.5">
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label="返回"
                onClick={() => {
                  if (!browse?.path) {
                    setPanel('main')
                    setBrowse(null)
                    return
                  }
                  if (browse.parent) void loadBrowse(browse.parent)
                  else void startBrowse()
                }}
              >
                <ChevronLeft className="size-4"/>
              </Button>
              <p className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground" title={browse?.path}>
                {browse?.path ?? '…'}
              </p>
            </div>
            <ScrollArea className="max-h-52">
              {loading ? (
                <p className="flex items-center gap-2 px-3 py-6 text-meta text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" aria-hidden/>
                  正在读取
                </p>
              ) : (
                <ul className="p-1">
                  {browse?.entries.map((entry) => (
                    <li key={entry.path}>
                      <button
                        type="button"
                        onClick={() => void loadBrowse(entry.path)}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {entry.is_git_repo ? (
                          <FolderGit2 className="size-4 shrink-0 text-signal" aria-label="Git 仓库"/>
                        ) : (
                          <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden/>
                        )}
                        <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                      </button>
                    </li>
                  ))}
                  {browse && browse.entries.length === 0 && (
                    <p className="px-3 py-4 text-center text-meta text-faint">没有子目录</p>
                  )}
                </ul>
              )}
            </ScrollArea>
            <div className="border-t p-2">
              <Button
                type="button"
                size="sm"
                className="w-full"
                disabled={!browse?.path}
                onClick={() => {
                  if (!browse?.path) return
                  const name = browse.path.split('/').filter(Boolean).pop() ?? browse.path
                  pick({path: browse.path, name, available: true, reason: null})
                }}
              >
                选择此目录
              </Button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
