'use client'

import {useEffect, useState} from 'react'
import {useRouter} from 'next/navigation'
import {toast} from 'sonner'
import {ChatInput} from '@/components/chat-input'
import {BrandMark} from '@/components/brand-mark'
import {ApiError} from '@/lib/api/fetch'
import {projectApi} from '@/lib/api/project'
import {sessionApi} from '@/lib/api/session'
import type {FileInfo, ProjectView} from '@/lib/api/types'

export default function Page() {
  const router = useRouter()
  const [sending, setSending] = useState(false)
  const [projectsEnabled, setProjectsEnabled] = useState(false)
  const [selectedProject, setSelectedProject] = useState<ProjectView | null>(null)

  useEffect(() => {
    projectApi.getRoots().then((data) => setProjectsEnabled(data.enabled)).catch(() => setProjectsEnabled(false))
  }, [])

  const startTask = async (message: string, files: FileInfo[], options?: {mode?: 'plan' | 'normal'}) => {
    if (sending) return
    setSending(true)
    try {
      const session = await sessionApi.createSession()
      if (selectedProject) {
        try {
          await projectApi.bindSessionProject(session.session_id, selectedProject.path)
        } catch (err) {
          const msg = err instanceof ApiError ? err.msg : err instanceof Error ? err.message : '绑定项目失败'
          toast.error(msg)
          setSending(false)
          throw err
        }
      }
      const payload = JSON.stringify({
        message,
        attachments: files.map((file) => file.id),
        ...(options?.mode === 'plan' ? {mode: 'plan'} : {}),
      })
      const encoded = btoa(encodeURIComponent(payload))
      router.push(`/sessions/${session.session_id}?init=${encoded}`)
    } catch (err) {
      if (!(err instanceof ApiError)) {
        toast.error(err instanceof Error ? err.message : '创建会话失败')
      }
      setSending(false)
      throw err
    }
  }

  return (
    <main className="flex h-full min-h-0 items-center justify-center overflow-y-auto px-4 py-8 sm:px-6">
      <div className="w-full max-w-2xl">
        <div>
          <div className="flex items-center gap-2.5">
            <BrandMark className="size-7"/>
            <h1 className="text-xl font-medium">想在 RayAgent 中做什么</h1>
          </div>
          <p className="mt-1 text-meta text-muted-foreground">
            描述目标，或说明要交付的文件。
          </p>
        </div>
        <div className="mt-6">
          <ChatInput
            onSend={startTask}
            disabled={sending}
            placeholder="描述你想完成的任务"
            projectsEnabled={projectsEnabled}
            projectBindable
            selectedProject={selectedProject}
            onProjectSelect={setSelectedProject}
            commandHost={{
              hasSession: false,
              hasRuns: false,
              runStatus: 'idle',
              waitingApproval: false,
              waitingReply: false,
              submitting: sending,
              compacting: false,
              projectsEnabled,
              projectBindable: true,
              actions: {compact: () => toast.message('还没有可压缩的上下文')},
            }}
          />
        </div>
      </div>
    </main>
  )
}
