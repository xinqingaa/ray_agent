import type {ContextPreview} from "./types";
import { get, post, put, createSSEStream, parseSSEStream } from "./fetch";
import type {
  Session,
  ConversationSummary,
  SessionDetail,
  SessionsData,
  CreateSessionParams,
  ChatParams,
  ChatAccepted,
  CompactResult,
  ApprovalAccepted,
  ApprovalDecision,
  TurnRequest,
  SessionFile,
  ViewFileParams,
  ViewShellParams,
  SSEEventData,
  SSEEventHandler,
} from "./types";

/**
 * 会话列表流式更新回调
 */
type SessionsStreamCallback = (sessions: Session[]) => void;

/**
 * 会话模块 API
 */
export const sessionApi = {
  summary: (id: string) => get<ConversationSummary>(`/sessions/${id}/summary`),
  editSummary: (id: string, content: string, baseGeneration: number) => put<ConversationSummary>(`/sessions/${id}/summary`, {content, base_generation: baseGeneration}),
  regenerateSummary: (id: string) => post<ConversationSummary>(`/sessions/${id}/summary/regenerate`, {}),
  renameTitle: (sessionId: string, title: string): Promise<{title: string}> =>
    put<{title: string}>(`/sessions/${sessionId}/title`, {title}),

  suggestTitle: (sessionId: string): Promise<{title: string}> =>
    post<{title: string}>(`/sessions/${sessionId}/title/suggestion`, {}, {timeout: 28000}),
  /**
   * 获取会话列表
   */
  getSessions: (offset = 0, independent = true, limit = 50): Promise<SessionsData> => {
    return get<SessionsData>("/sessions", {offset, independent, limit});
  },

  /**
   * 创建新会话
   */
  createSession: (params?: CreateSessionParams): Promise<Session> => {
    return post<Session>("/sessions", params || {});
  },

  /**
   * 流式订阅会话列表更新（SSE）
   *
   * 通过 /sessions/stream 端点建立 SSE 长连接，
   * 服务端定期推送完整的会话列表数据。
   *
   * 使用 AbortController 管理连接生命周期，调用返回的清理函数
   * 可以彻底中止底层 fetch 连接，避免连接泄漏。
   *
   * @param onSessions 每次收到新会话列表时的回调
   * @param onError    连接异常或流结束时的回调（可用于触发重连）
   * @returns 清理函数，调用后会彻底关闭连接
   */
  streamSessions: (
    onSessions: SessionsStreamCallback,
    onError?: (error: Error) => void,
    onCatalog?: (hint: {kind: 'session' | 'project'; id: string}) => void,
  ): (() => void) => {
    const controller = new AbortController();

    const startStream = async () => {
      try {
        const stream = await createSSEStream("/sessions/stream?independent=true", {}, {
          signal: controller.signal,
        });

        await parseSSEStream(
          stream,
          (messageEvent) => {
            if (controller.signal.aborted) return;

            const data =
              typeof messageEvent.data === "string"
                ? JSON.parse(messageEvent.data)
                : messageEvent.data;

            if (messageEvent.type === "catalog" && (data?.kind === "session" || data?.kind === "project") && data?.id) {
              onCatalog?.({kind: data.kind, id: String(data.id)});
              return;
            }
            // 服务端事件格式: event: sessions  data: { sessions: [...] }
            // 注意：部分事件可能没有 event: 行，此时 type 默认为 "message"
            // 因此只校验数据结构，不强制要求 type === "sessions"
            if (data?.sessions && Array.isArray(data.sessions)) {
              onSessions(data.sessions as Session[]);
            }
          },
          (error) => {
            if (!controller.signal.aborted && onError) {
              onError(error);
            }
          }
        );

        // 流正常结束（服务端关闭连接），通知上层以便重连
        if (!controller.signal.aborted && onError) {
          onError(new Error("SSE 流已结束"));
        }
      } catch (error) {
        if (!controller.signal.aborted && onError) {
          onError(
            error instanceof Error ? error : new Error("SSE 连接失败")
          );
        }
      }
    };

    startStream();

    // 返回清理函数：通过 abort 彻底中止底层 fetch 连接
    return () => {
      controller.abort();
    };
  },

  /**
   * 获取会话详情
   */
  getSession: (sessionId: string): Promise<Session> => {
    return get<Session>(`/sessions/${sessionId}`);
  },

  /**
   * 获取会话详情：运行列表、事件（按 seq 升序）与 last_seq
   */
  getSessionDetail: (sessionId: string, afterSeq?: number): Promise<SessionDetail> => {
    return get<SessionDetail>(`/sessions/${sessionId}${afterSeq != null ? `?after_seq=${afterSeq}` : ''}`);
  },

  /**
   * 提交消息；返回受理的运行与消息 seq，事件通过 streamEvents 订阅
   */
  previewContext: (sessionId: string, mode: string = "normal"): Promise<ContextPreview> => get<ContextPreview>(`/sessions/${sessionId}/context-preview?mode=${mode}`),

  setModel: (sessionId: string, selection: {model: string; reasoning: string}): Promise<{model: string; reasoning: string}> =>
    put<{model: string; reasoning: string}>(`/sessions/${sessionId}/model`, selection),

  chat: (sessionId: string, params: ChatParams): Promise<ChatAccepted> => {
    return post<ChatAccepted>(`/sessions/${sessionId}/chat`, params);
  },

  /**
   * 手动压缩会话上下文；结果通过事件流写入，不在前端伪造时间线条目
   */
  compact: (sessionId: string): Promise<CompactResult> => {
    return post<CompactResult>(`/sessions/${sessionId}/compact`, {}, {timeout: 70000});
  },

  /**
   * 订阅会话事件（SSE）：先补发 seq 大于 afterSeq 的历史事件，再推送新事件，
   * SSE id 即 seq。流结束或出错时回调 onError，由调用方按最新 seq 重连。
   * @returns 清理函数
   */
  streamEvents: (
    sessionId: string,
    afterSeq: number,
    onEvent: SSEEventHandler,
    onError?: (error: Error) => void
  ): (() => void) => {
    const controller = new AbortController();

    const startStream = async () => {
      try {
        const stream = await createSSEStream(
          `/sessions/${sessionId}/events?after_seq=${afterSeq}`,
          undefined,
          { method: "GET", signal: controller.signal }
        );

        await parseSSEStream(
          stream,
          (messageEvent) => {
            if (controller.signal.aborted) return;
            const data =
              typeof messageEvent.data === "string"
                ? JSON.parse(messageEvent.data)
                : messageEvent.data;
            if (messageEvent.type === "ping") return;
            const seqFromId = /^\d+$/.test(messageEvent.lastEventId)
              ? Number(messageEvent.lastEventId)
              : undefined;
            const withSeq =
              data &&
              typeof data === "object" &&
              (data as { seq?: unknown }).seq == null &&
              seqFromId !== undefined
                ? { ...(data as Record<string, unknown>), seq: seqFromId }
                : data;
            onEvent({
              type: messageEvent.type as SSEEventData["type"],
              data: withSeq,
            } as SSEEventData);
          },
          (error) => {
            if (!controller.signal.aborted && onError) {
              onError(error);
            }
          }
        );

        if (!controller.signal.aborted && onError) {
          onError(new Error("SSE_STREAM_END"));
        }
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          return;
        }
        if (!controller.signal.aborted && onError) {
          onError(
            error instanceof Error ? error : new Error("订阅会话事件失败")
          );
        }
      }
    };

    startStream();

    return () => {
      controller.abort();
    };
  },

  /**
   * 读取某一轮重建出的模型请求（只读）
   */
  getTurnRequest: (
    sessionId: string,
    runId: string,
    index: number
  ): Promise<TurnRequest> => {
    return get<TurnRequest>(
      `/sessions/${sessionId}/runs/${runId}/turns/${index}/request`
    );
  },

  /**
   * 答复工具审批：approve 执行该调用一次，deny 回填“用户拒绝执行”。
   * 已答复或已失效返回 409（ApiError.code 为 409），不会重复执行
   */
  replyApproval: (
    sessionId: string,
    toolCallId: string,
    decision: ApprovalDecision
  ): Promise<ApprovalAccepted> => {
    return post<ApprovalAccepted>(
      `/sessions/${sessionId}/approvals/${encodeURIComponent(toolCallId)}`,
      { decision }
    );
  },

  /**
   * 停止会话
   */
  stopSession: (sessionId: string): Promise<{ run_id: string } | null> => {
    return post<{ run_id: string } | null>(`/sessions/${sessionId}/stop`, {});
  },

  /**
   * 删除会话
   */
  deleteSession: (sessionId: string): Promise<void> => {
    return post<void>(`/sessions/${sessionId}/delete`, {});
  },

  /**
   * 清除未读消息数
   */
  clearUnreadMessageCount: (sessionId: string): Promise<void> => {
    return post<void>(
      `/sessions/${sessionId}/clear-unread-message-count`,
      {}
    );
  },

  /**
   * 获取会话文件列表
   */
  getSessionFiles: (sessionId: string): Promise<SessionFile[]> => {
    return get<SessionFile[]>(`/sessions/${sessionId}/files`);
  },

  /**
   * 查看沙箱文件内容
   */
  viewFile: (
    sessionId: string,
    params: ViewFileParams
  ): Promise<{ content: string; [key: string]: unknown }> => {
    return post<{ content: string; [key: string]: unknown }>(
      `/sessions/${sessionId}/file`,
      params
    );
  },

  /**
   * 查看 Shell 输出
   */
  viewShell: (
    sessionId: string,
    params: ViewShellParams
  ): Promise<{ output: string; [key: string]: unknown }> => {
    return post<{ output: string; [key: string]: unknown }>(
      `/sessions/${sessionId}/shell`,
      params
    );
  },
};
