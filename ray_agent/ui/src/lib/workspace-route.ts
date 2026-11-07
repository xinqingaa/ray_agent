/** 工作区路由：`/workspaces/:id` 是工作区首页，`/workspaces/:id/sessions/:sid` 是其中的会话。 */
export type WorkspaceRoute = {workspaceId: string | null; sessionId: string | null}

export function parseWorkspaceRoute(pathname: string): WorkspaceRoute {
  const match = /^\/workspaces\/([^/]+)(?:\/sessions\/([^/]+))?\/?$/.exec(pathname)
  if (!match) return {workspaceId: null, sessionId: null}
  return {workspaceId: decodeURIComponent(match[1]), sessionId: match[2] ? decodeURIComponent(match[2]) : null}
}

export const workspaceHref = (workspaceId: string) => `/workspaces/${encodeURIComponent(workspaceId)}`
export const workspaceSessionHref = (workspaceId: string, sessionId: string) =>
  `${workspaceHref(workspaceId)}/sessions/${encodeURIComponent(sessionId)}`
