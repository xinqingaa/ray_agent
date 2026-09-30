import { del, get, put, post } from "./fetch";
import type {
  BrowseListing,
  ProjectFile,
  ProjectListing,
  ProjectRootsData,
  ProjectView,
  ProjectDetails, ProjectPage, ProjectSettings, SessionsData,
} from "./types";

export const projectApi = {
  getRoots: (): Promise<ProjectRootsData> => get<ProjectRootsData>("/projects/roots"),

  browse: (path: string): Promise<BrowseListing> =>
    get<BrowseListing>("/projects/browse", { path }),

  list: (archived = false, offset = 0, limit = 50): Promise<ProjectPage> =>
    get<ProjectPage>("/projects", {archived, offset, limit}),
  create: (path: string, name?: string): Promise<ProjectDetails> => post<ProjectDetails>("/projects", {path, name}),
  detail: (id: string): Promise<ProjectDetails> => get<ProjectDetails>(`/projects/${id}`),
  update: (id: string, settings: ProjectSettings): Promise<ProjectDetails> => put<ProjectDetails>(`/projects/${id}`, settings),
  archive: (id: string, archived: boolean): Promise<ProjectDetails> => post<ProjectDetails>(`/projects/${id}/archive`, {archived}),
  sessions: (id: string, offset = 0, limit = 50): Promise<SessionsData> => get<SessionsData>(`/projects/${id}/sessions`, {offset, limit}),

  bindSessionProject: (sessionId: string, projectId: string): Promise<ProjectView> =>
    put<ProjectView>(`/sessions/${sessionId}/project`, { project_id: projectId }),

  unbindSessionProject: (sessionId: string): Promise<null> =>
    del<null>(`/sessions/${sessionId}/project`),

  getTree: (id: string, path = "", projectLevel = false): Promise<ProjectListing> =>
    get<ProjectListing>(projectLevel ? `/projects/${id}/tree` : `/sessions/${id}/project/tree`, { path }),

  getFile: (id: string, path: string, projectLevel = false): Promise<ProjectFile> =>
    get<ProjectFile>(projectLevel ? `/projects/${id}/file` : `/sessions/${id}/project/file`, { path }),
};
