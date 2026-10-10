'use client'
import {useRef} from 'react'
import {MemoryEditor} from './project-memory-panel'
import {useUnsavedNavigation} from '@/hooks/use-unsaved-navigation'
import {History} from 'lucide-react'
import {IconAction} from '@/components/ui/icon-action'
import type {ProjectDetails} from '@/lib/api/types'

export function ProjectMemoryPage({project, field, onSaved, onHistory}: {project: ProjectDetails; field: 'instructions' | 'notes'; onSaved: () => void; onHistory: () => void}) {
  const dirty = useRef(false)
  useUnsavedNavigation(() => dirty.current)
  return <section className="max-w-4xl"><MemoryEditor field={field} project={project} restored={null} onDirty={value => {dirty.current = value}} onSaved={onSaved} toolbar={<><p className="mr-auto text-sm text-muted-foreground">{field === 'instructions' ? '后续对话持续遵守的要求' : '与 Agent 共同维护的背景与结论'}</p><IconAction label={field === 'notes' ? '查看笔记修改记录' : '查看说明修改记录'} onClick={onHistory}><History/></IconAction></>}/></section>
}
