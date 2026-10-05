import { get, put, post, uploadRequest, ApiError } from "./fetch";
import type {
  ChatAccepted, ProjectMemoryView, ProjectFile,
  ProjectListing,
  ProjectDetails, ProjectPage, ProjectUpdate, SessionsData,
  ProjectSnapshot, ProjectAuditEvent, ProjectUploadRules, ProjectUploadSelection, ProjectUploadPreflight, ProjectOperationResult, ProjectUploadResult,
} from "./types";

export const projectApi = {
  startChat: (id:string, creationId:string, payload:{message:string;attachments:string[];mode:'normal'|'plan';model?:string;reasoning?:string}) => post<ChatAccepted & {session_id:string}>(`/projects/${id}/chat`,{...payload,creation_id:creationId}),
  estimateMemory: (id:string, sessionId?:string, mode='normal') => get<ProjectMemoryView>(`/projects/${id}/memory/estimate`,{...(sessionId?{session_id:sessionId}:{}),mode}),
  memory: (id:string, sessionId?:string) => get<ProjectMemoryView>(`/projects/${id}/memory`,sessionId ? {session_id:sessionId} : {}),
  memoryHistory: (id:string, beforeSeq=0) => get<ProjectAuditEvent[]>(`/projects/${id}/memory/history`,{before_seq:beforeSeq}),
  updateNotes: (id:string, content:string, version:number) => put<{content:string; notes_version:number}>(`/projects/${id}/notes`,{content,base_version:version}),
  list: (archived = false, offset = 0, limit = 50): Promise<ProjectPage> =>
    get<ProjectPage>("/projects", {archived, offset, limit}),
  create: (name: string, instructions?: string, creationId?: string): Promise<ProjectDetails> => post<ProjectDetails>("/projects", {name, instructions, creation_id:creationId}),
  detail: (id: string): Promise<ProjectDetails> => get<ProjectDetails>(`/projects/${id}`),
  update: (id: string, settings: ProjectUpdate): Promise<ProjectDetails> => put<ProjectDetails>(`/projects/${id}`, settings),
  archive: (id: string, archived: boolean): Promise<ProjectDetails> => post<ProjectDetails>(`/projects/${id}/archive`, {archived}),
  sessions: (id: string, offset = 0, limit = 50): Promise<SessionsData> => get<SessionsData>(`/projects/${id}/sessions`, {offset, limit}),

  uploadRules: () => get<ProjectUploadRules>('/projects/upload-rules'),
  snapshots: (id: string) => get<ProjectSnapshot[]>(`/projects/${id}/snapshots`),
  restore: (id: string, snapshot: string) => post<ProjectOperationResult>(`/projects/${id}/snapshots/${snapshot}/restore`, {}, {timeout: 120000}),
  repairRestore: (id: string, operation: string, returnBefore: boolean) => post<ProjectOperationResult>(`/projects/${id}/restore/repair`, {operation_id: operation, return_before: returnBefore}, {timeout: 120000}),
  cleanupSnapshots: (id: string) => post<ProjectOperationResult>(`/projects/${id}/snapshots/cleanup`, {}, {timeout: 120000}),
  retrySettling: (id: string) => post<ProjectDetails>(`/projects/${id}/settling/retry`, {}, {timeout: 60000}),
  reconcile: (id: string, operation: string) => post<ProjectOperationResult>(`/projects/${id}/operations/reconcile`, {operation_id: operation}, {timeout: 120000}),
  events: (id: string, afterSeq = 0) => get<ProjectAuditEvent[]>(`/projects/${id}/events`, {after_seq: afterSeq, limit: 50}),
  preflight: (id: string, selection: ProjectUploadSelection) => post<ProjectUploadPreflight>(`/projects/${id}/uploads/preflight`, selection, {timeout: 120000}),
  startUpload: (id: string, selection: ProjectUploadSelection) => post<ProjectOperationResult>(`/projects/${id}/uploads`, selection, {timeout: 120000}),
  uploadItem: (id: string, operation: string, path: string, file: File, onProgress?: (loaded:number,total:number)=>void) => {
    const form = new FormData(); form.append('file', file);
    return uploadRequest<ProjectUploadResult>(`/projects/${id}/uploads/${operation}/file?path=${encodeURIComponent(path)}`, form, onProgress);
  },
  finishUpload: (id: string, operation: string, cancel = false) => post<ProjectOperationResult>(`/projects/${id}/uploads/${operation}/finish?cancel=${cancel}`, {}, {timeout: 120000}),
  operation: (id: string, operation: string) => get<ProjectOperationResult>(`/projects/${id}/operations/${operation}`),
  fileCopies: (id: string) => get<Array<{copy_key: string; kind: string; state: string; path: string | null; error: string | null; resolved_path: string | null; session_id?: string; attachment_id?: string; source_path?: string | null; size?: number}>>(`/projects/${id}/file-copies`),
  retryDelivery: (id: string, copyKey: string) => post<Record<string, unknown>>(`/projects/${id}/deliveries/retry`, {copy_key: copyKey}, {timeout: 120000}),
  download: async (id: string, path?: string) => {
    const base = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8088/api';
    const url = `${base}/projects/${id}/download${path == null ? '' : '?path=' + encodeURIComponent(path)}`;
    const response = await fetch(url, {method: 'HEAD'});
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new ApiError(response.status, body?.msg || `下载不可用（HTTP ${response.status}），请重新读取项目文件状态`);
    }
    const header = response.headers.get('Content-Disposition') || '';
    const match = header.match(/filename\*=utf-8''(.+)/i);
    return {url, filename: match ? decodeURIComponent(match[1]) : path?.split('/').pop() || 'project.zip',
      warning: decodeURIComponent(response.headers.get('X-RayAgent-Download-Warning') || '')};
  },

  getTree: (id: string, path = "", projectLevel = false): Promise<ProjectListing> =>
    get<ProjectListing>(projectLevel ? `/projects/${id}/tree` : `/sessions/${id}/project/tree`, { path }),

  getFile: (id: string, path: string, projectLevel = false): Promise<ProjectFile> =>
    get<ProjectFile>(projectLevel ? `/projects/${id}/file` : `/sessions/${id}/project/file`, { path }),
};
