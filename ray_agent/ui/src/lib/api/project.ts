import { del, get, put } from "./fetch";
import type {
  BrowseListing,
  GitDiff,
  GitDiffScope,
  GitStatus,
  ProjectFile,
  ProjectListing,
  ProjectRootsData,
  ProjectView,
} from "./types";

export const projectApi = {
  getRoots: (): Promise<ProjectRootsData> => get<ProjectRootsData>("/projects/roots"),

  browse: (path: string): Promise<BrowseListing> =>
    get<BrowseListing>("/projects/browse", { path }),

  getRecent: (limit = 10): Promise<ProjectView[]> =>
    get<ProjectView[]>("/projects/recent", { limit }),

  bindSessionProject: (sessionId: string, path: string): Promise<ProjectView> =>
    put<ProjectView>(`/sessions/${sessionId}/project`, { path }),

  unbindSessionProject: (sessionId: string): Promise<null> =>
    del<null>(`/sessions/${sessionId}/project`),

  getTree: (sessionId: string, path = ""): Promise<ProjectListing> =>
    get<ProjectListing>(`/sessions/${sessionId}/project/tree`, { path }),

  getFile: (sessionId: string, path: string): Promise<ProjectFile> =>
    get<ProjectFile>(`/sessions/${sessionId}/project/file`, { path }),

  getGitStatus: (sessionId: string): Promise<GitStatus> =>
    get<GitStatus>(`/sessions/${sessionId}/project/git/status`),

  getGitDiff: (
    sessionId: string,
    scope: GitDiffScope,
    path?: string
  ): Promise<GitDiff> =>
    get<GitDiff>(`/sessions/${sessionId}/project/git/diff`, {
      scope,
      ...(path ? { path } : {}),
    }),
};
