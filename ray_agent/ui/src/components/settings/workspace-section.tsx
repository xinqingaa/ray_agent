import {useCallback, useEffect, useState} from 'react'
import {toast} from 'sonner'
import {Button} from '@/components/ui/button'
import {workspaceApi} from '@/lib/api/workspace'
import {isDesktop, selectFolderGrant} from '@/lib/platform'
import {LoadError, SectionHeader} from './form'
import {SettingsRow} from './settings-row'

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

  return <section aria-labelledby="settings-workspace-title">
    <SectionHeader id="settings-workspace-title" title="工作区"/>
    {error ? <div className="py-4"><LoadError message={error} onRetry={() => void load()}/></div> : <div className="divide-y divide-border/70">
      <SettingsRow
        id="workspace-location"
        title="新建工作区的位置"
        description={<>
          <span className="block break-all font-mono">{path ?? '正在读取…'}</span>
          {!desktop && <span className="mt-1 block">更改位置需要在 RayAgent 桌面应用中进行。</span>}
        </>}
        control={<Button type="button" variant="outline" size="sm" disabled={!desktop || busy || path == null} onClick={() => void change()}>
          {busy ? '正在更改' : '更改'}
        </Button>}
      />
      <SettingsRow
        id="workspace-execution"
        title="本机执行"
        description="运行命令与脚本按工作区单独开启，在工作区菜单里设置。"
        control={<span className="text-sm text-muted-foreground">按工作区</span>}
      />
      <SettingsRow
        id="workspace-index-scope"
        title="知识索引范围"
        description="索引内容类型、Agent 产出准入与排除规则按工作区单独管理，在工作区的「知识 → 索引」或文件夹右键菜单中设置。"
        control={<span className="text-sm text-muted-foreground">按工作区</span>}
      />
    </div>}
  </section>
}
