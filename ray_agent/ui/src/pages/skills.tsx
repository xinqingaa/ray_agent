import {useState} from 'react'
import {useLocation, useSearchParams} from 'react-router'
import {toast} from 'sonner'
import {SkillsSection} from '@/components/settings/skills-section'
import {useUnsavedGuard} from '@/components/settings/form'
import {useWorkspaces} from '@/providers/workspaces-provider'
import {skillReturnHref} from '@/lib/skill-route'

export function SkillsPage() {
  const [params, setParams] = useSearchParams()
  const {state} = useLocation()
  const workspaceId = params.get('workspace') || undefined
  const {workspaces} = useWorkspaces()
  const [view, setView] = useState<'installed' | 'market'>('installed')
  const [dirty, setDirty] = useState(false)
  useUnsavedGuard(dirty, () => toast.warning('请先保存或关闭当前 Skill 编辑。'))

  return <SkillsSection key={workspaceId ?? 'global'} workspaceId={workspaceId}
    view={view} onViewChange={setView} backHref={skillReturnHref(state)} workspaces={workspaces} onDirtyChange={setDirty}
    onWorkspaceChange={id => {
      if (dirty) return
      setParams(current => {
        const next = new URLSearchParams(current)
        if (id) next.set('workspace', id)
        else next.delete('workspace')
        return next
      }, {replace: true, state})
    }}/>
}
