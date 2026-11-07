import {useCallback, useEffect, useState} from 'react'
import {toast} from 'sonner'
import {Button} from '@/components/ui/button'
import {workspaceApi} from '@/lib/api/workspace'
import {isDesktop, selectFolderGrant} from '@/lib/platform'
import {LoadError, SectionHeader} from './form'

/** 新建工作区时放置文件夹的默认位置；选择位置需要桌面应用的原生文件夹选择器。 */
export function WorkspaceSection() {
  const [path, setPath] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const desktop = isDesktop()

  const load = useCallback(async () => {
    try {setPath(await workspaceApi.defaultLocation()); setError(null)}
    catch (reason) {setError(reason instanceof Error ? reason.message : '读取默认位置失败')}
  }, [])
  useEffect(() => {
    const frame = requestAnimationFrame(() => {void load()})
    return () => cancelAnimationFrame(frame)
  }, [load])

  const change = async () => {
    setBusy(true)
    try {
      const grant = await selectFolderGrant('default_location')
      if (!grant) return
      setPath(await workspaceApi.setDefaultLocation(grant.grant_id))
      toast.success('已更改默认位置，之后新建的工作区会放在这里')
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : '更改失败')
    } finally {setBusy(false)}
  }

  return <section aria-labelledby="settings-workspace-title" className="space-y-6">
    <SectionHeader id="settings-workspace-title" title="工作区" description="新建工作区时，会在默认位置创建一个同名文件夹。已有工作区的文件夹位置不受影响。"/>
    {error ? <LoadError message={error} onRetry={() => void load()}/> : <div className="space-y-2">
      <p className="text-sm font-medium">默认位置</p>
      <p className="break-all rounded-md border bg-muted/40 px-3 py-2 font-mono text-xs">{path ?? '正在读取…'}</p>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" disabled={!desktop || busy || path == null} onClick={() => void change()}>{busy ? '正在更改' : '更改位置'}</Button>
        {!desktop && <p className="text-meta text-muted-foreground">更改位置需要在 RayAgent 桌面应用中进行。</p>}
      </div>
    </div>}
  </section>
}
