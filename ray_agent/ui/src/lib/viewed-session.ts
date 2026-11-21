/** 从路由取出当前停留的会话：独立对话 `/sessions/:id`，工作区会话 `/workspaces/:wid/sessions/:sid`；其他页面为 null。 */
export function viewedSessionId(pathname: string): string | null {
  const match = /^\/(?:workspaces\/[^/]+\/)?sessions\/([^/]+)\/?$/.exec(pathname)
  if (!match) return null
  try {
    return decodeURIComponent(match[1])
  } catch {
    return null
  }
}
