'use client'
import {use} from 'react'
import {ProjectWorkspace} from '@/components/project-workspace'
export default function ProjectPage({params}: {params: Promise<{id: string}>}) {
  const {id} = use(params)
  return <ProjectWorkspace key={id} projectId={id}/>
}
