export function skillsHref(workspaceId?: string | null) {
  return workspaceId ? `/skills?${new URLSearchParams({workspace: workspaceId})}` : '/skills'
}

export function skillReturnHref(state: unknown): string | undefined {
  if (typeof state !== 'object' || state === null || !('returnTo' in state)) return
  if (typeof state.returnTo !== 'string' || !/^\/(?:$|(?:workspaces|sessions|settings)(?:[/?#]|$))/.test(state.returnTo)) return
  return state.returnTo
}
