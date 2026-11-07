import {createSSEStream, get, parseSSEStream, post, request} from './fetch'
import type {
  ChangePreview, ConflictResolution, ModifiedRun, OpenWorkspaceResult, OperationView, RootEntry, RootListing,
  RunChanges, UndoItemRequest, UndoItemResult, WorkspaceChangeEvent, WorkspaceItem, WriteLease,
} from './types'

/** 工作区、默认位置与长操作。文件夹授权由宿主产生（见 platform.ts 的 `selectFolderGrant`），这里只带 grant_id。 */
export const workspaceApi = {
  list: () => get<{workspaces: WorkspaceItem[]}>('/workspaces').then(data => data.workspaces),
  get: (id: string) => get<WorkspaceItem>(`/workspaces/${encodeURIComponent(id)}`),
  create: (name: string) => post<WorkspaceItem>('/workspaces', {name}),
  open: (grantId: string, name?: string) =>
    post<OpenWorkspaceResult>('/workspaces/open', {grant_id: grantId, ...(name ? {name} : {})}),
  resolveConflict: (conflictId: string, resolution: ConflictResolution) =>
    post<OpenWorkspaceResult>('/workspaces/open/resolve', {conflict_id: conflictId, resolution}),
  defaultLocation: () => get<{path: string}>('/workspaces/default-location').then(data => data.path),
  setDefaultLocation: (grantId: string) =>
    post<{path: string}>('/workspaces/default-location', {grant_id: grantId}).then(data => data.path),
  rename: (workspace: WorkspaceItem, name: string) =>
    post<WorkspaceItem>(`/workspaces/${encodeURIComponent(workspace.id)}/rename`, {name, version: workspace.version}),
  archive: (workspace: WorkspaceItem) =>
    post<WorkspaceItem>(`/workspaces/${encodeURIComponent(workspace.id)}/archive`, {version: workspace.version}),
  unarchive: (workspace: WorkspaceItem) =>
    post<WorkspaceItem>(`/workspaces/${encodeURIComponent(workspace.id)}/unarchive`, {version: workspace.version}),
  /** 用宿主选择器产生的 grant_id 改绑到另一个文件夹，不依赖身份标记；核心同时把变更订阅切到新位置。 */
  relocate: (workspace: WorkspaceItem, grantId: string) =>
    post<WorkspaceItem>(`/workspaces/${encodeURIComponent(workspace.id)}/relocate`, {grant_id: grantId, version: workspace.version}),
  recheck: (id: string) => post<WorkspaceItem>(`/workspaces/${encodeURIComponent(id)}/recheck`, {}),
  remove: (id: string) => post<OperationView>(`/workspaces/${encodeURIComponent(id)}/delete`, {}),
}

export const operationApi = {
  get: (id: string) => get<OperationView>(`/operations/${encodeURIComponent(id)}`),
  retry: (id: string) => post<OperationView>(`/operations/${encodeURIComponent(id)}/retry`, {}),
}

/** 根内文件：位置一律是 root_id 加相对路径，不提交桌面绝对路径。 */
export const rootApi = {
  entries: (rootId: string, path = '') =>
    get<RootListing>(`/roots/${encodeURIComponent(rootId)}/entries`, {path}),
  entry: (rootId: string, path: string) =>
    get<{entry: RootEntry}>(`/roots/${encodeURIComponent(rootId)}/entry`, {path}).then(data => data.entry),
  /** 复制进文件夹：默认放在根目录，directory 指定子目录；同名不覆盖，返回的名称可能带序号。 */
  upload: (rootId: string, file: File, directory = '') => {
    const form = new FormData()
    form.append('file', file)
    form.append('directory', directory)
    return request<{entry: RootEntry}>(`/roots/${encodeURIComponent(rootId)}/upload`, {method: 'POST', body: form, timeout: 120000})
      .then(data => data.entry)
  },
}

const workspacePath = (id: string) => `/workspaces/${encodeURIComponent(id)}`

/** 文件夹的写入租约、运行的文件变更与撤销、外部变更订阅。 */
export const historyApi = {
  writeLease: (id: string) => get<{lease: WriteLease | null}>(`${workspacePath(id)}/write-lease`).then(data => data.lease),
  /** 租约处于 settling 或 blocked 时再次要求写入者退出并确认；仍未确认时核心返回 409。 */
  retrySettle: (id: string) => post<{lease: WriteLease | null}>(`${workspacePath(id)}/write-lease/retry-settle`, {}),
  modifiedRuns: (id: string, limit?: number) =>
    get<{runs: ModifiedRun[]}>(`${workspacePath(id)}/modified-runs`, limit ? {limit} : undefined).then(data => data.runs),
  runChanges: (id: string, runId: string) =>
    get<RunChanges>(`${workspacePath(id)}/runs/${encodeURIComponent(runId)}/changes`),
  preview: (id: string, runId: string, path: string) =>
    get<ChangePreview>(`${workspacePath(id)}/runs/${encodeURIComponent(runId)}/changes/preview`, {path}),
  undo: (id: string, runId: string, items: UndoItemRequest[]) =>
    post<{results: UndoItemResult[]}>(`${workspacePath(id)}/runs/${encodeURIComponent(runId)}/undo`, {items})
      .then(data => data.results),
  /**
   * 订阅文件夹的外部变更（SSE）：先 ready，之后 changed / availability。
   * 连接异常或服务端结束时回调 onError，由调用方按重连策略重新订阅；返回的函数中止连接。
   */
  streamChanges: (
    id: string,
    onEvent: (event: WorkspaceChangeEvent) => void,
    onError: (error: Error) => void,
  ): (() => void) => {
    const controller = new AbortController()
    void (async () => {
      try {
        const stream = await createSSEStream(`${workspacePath(id)}/changes/stream`, undefined, {method: 'GET', signal: controller.signal})
        await parseSSEStream(
          stream,
          message => {
            if (controller.signal.aborted || message.type === 'ping') return
            const data = typeof message.data === 'string' ? JSON.parse(message.data) : message.data
            if (data && (data.kind === 'ready' || data.kind === 'changed' || data.kind === 'availability')) onEvent(data as WorkspaceChangeEvent)
          },
          error => {if (!controller.signal.aborted) onError(error)},
        )
        if (!controller.signal.aborted) onError(new Error('SSE_STREAM_END'))
      } catch (error) {
        if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) return
        onError(error instanceof Error ? error : new Error('订阅文件夹变更失败'))
      }
    })()
    return () => controller.abort()
  },
}
