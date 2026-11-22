import {Finder, FolderPlus, Plus} from '@/components/ui/icons'
import {IconAction} from '@/components/ui/icon-action'

/** 文件夹面板头部的操作：添加文件、新建文件夹（都放进所选目录，没有选择时是根目录）与在系统中显示。 */
export function FolderToolbarActions({directory, adding, onAdd, onNewFolder, revealLabel, onReveal}: {
  directory: string
  adding?: boolean
  onAdd?: () => void
  onNewFolder?: () => void
  revealLabel: string
  onReveal?: () => void
}) {
  return <>
    {onAdd && <IconAction label={`${adding ? '正在添加文件到' : '添加文件到'}「${directory}」`} disabled={adding}
      onClick={onAdd} className="text-muted-foreground"><Plus className="size-4" aria-hidden/></IconAction>}
    {onNewFolder && <IconAction label={`在「${directory}」中新建文件夹`} onClick={onNewFolder} className="text-muted-foreground">
      <FolderPlus className="size-4" aria-hidden/></IconAction>}
    {onReveal && <IconAction label={revealLabel} onClick={onReveal} className="text-muted-foreground"><Finder className="size-4" aria-hidden/></IconAction>}
  </>
}
