'use client'
import {useState} from 'react'
import {RefreshCw, Upload, Download} from 'lucide-react'
import {toast} from 'sonner'
import {IconAction} from '@/components/ui/icon-action'
import {ProjectPane} from '@/components/workbench/project-pane'
import {ProjectUploadDialog} from '@/components/project-upload-dialog'
import {ProjectStateNotice, projectWriteReason} from '@/components/project-state-notice'
import {projectApi} from '@/lib/api/project'
import type {ProjectDetails} from '@/lib/api/types'

export function ProjectFilesPage({project, onChanged}: {project: ProjectDetails; onChanged: () => void}) {
  const [query, setQuery] = useState(''), [revision, setRevision] = useState(0), [upload, setUpload] = useState(false), [downloading, setDownloading] = useState(false)
  const changed = () => {setRevision(value => value+1); onChanged()}
  const reason = projectWriteReason(project)
  const download = async () => {
    setDownloading(true)
    try {const file = await projectApi.download(project.id); if (file.warning) toast.warning(file.warning); const link = document.createElement('a'); link.href=file.url; link.download=file.filename; link.click()}
    catch (error) {toast.error(error instanceof Error ? error.message : '下载失败')}
    finally {setDownloading(false)}
  }
  return <section className="flex min-h-[60vh] flex-col gap-4"><div className="flex flex-wrap items-center gap-2"><input aria-label="搜索项目文件" type="search" placeholder="搜索当前文件列表" value={query} onChange={event => setQuery(event.target.value)} className="mr-auto min-w-0 flex-1 rounded-md border bg-card px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring sm:max-w-xs"/><div className="ml-auto flex items-center gap-1"><IconAction label="刷新项目文件" onClick={changed}><RefreshCw/></IconAction><IconAction label={downloading ? '正在准备下载' : '下载全部项目文件'} disabled={!project.available || downloading} onClick={() => void download()}><Download/></IconAction><IconAction label={reason || '添加项目文件'} aria-label="添加项目文件" disabled={!!reason} onClick={() => setUpload(true)}><Upload/></IconAction></div></div><ProjectStateNotice project={project} showStats={false} onChanged={changed}/>{reason && <p className="text-sm text-muted-foreground">{reason}</p>}<ProjectPane sessionId={project.id} projectLevel downloadProjectId={project.id} fullPage query={query} refreshSignal={revision + Date.parse(project.updated_at || '1970-01-01')}/><ProjectUploadDialog open={upload} projectId={project.id} disabledReason={reason} onClose={() => setUpload(false)} onUploaded={changed}/></section>
}
