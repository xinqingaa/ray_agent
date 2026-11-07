import { get, post } from "./fetch";
import type { FileInfo, FileUploadParams } from "./types";

/**
 * 文件模块 API；下载与预览内容见 preview.ts
 */
export const fileApi = {
  /**
   * 上传文件
   * @param params 上传参数，包含文件和可选的会话 ID
   * @returns 文件信息
   */
  uploadFile: async (params: FileUploadParams): Promise<FileInfo> => {
    const formData = new FormData();
    formData.append("file", params.file);

    if (params.session_id) {
      formData.append("session_id", params.session_id);
    }

    return post<FileInfo>('/files', formData);
  },

  /**
   * 获取文件信息
   * @param fileId 文件 ID
   * @returns 文件信息
   */
  getFileInfo: (fileId: string): Promise<FileInfo> => {
    return get<FileInfo>(`/files/${fileId}`);
  },
};
