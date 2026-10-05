import {sessionApi} from '@/lib/api/session'

const pending = new Set<string>()

/** 在项目下建一条还没有消息的对话，返回会话 id。同一项目的重复点击只建一次。 */
export async function createProjectSession(projectId: string): Promise<string | null> {
  if (pending.has(projectId)) return null
  pending.add(projectId)
  try {
    const session = await sessionApi.createSession({
      project_id: projectId,
      creation_id: crypto.randomUUID(),
    })
    return session.session_id
  } finally {
    pending.delete(projectId)
  }
}
