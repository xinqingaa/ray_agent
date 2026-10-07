import { get, post } from "./fetch";
import type {
  LLMConfig,
  ModelSampling,
  SamplingBudget,
  ModelCatalog,
  AgentConfig,
  MCPConfig,
  MCPServersData,
  A2AServersData,
  CreateA2AServerParams,
  ToolPolicy,
  ToolPolicyConfig,
} from "./types";

/**
 * 配置模块 API
 */
export const configApi = {
  /**
   * 获取 LLM 配置
   */
  getLLMConfig: (): Promise<LLMConfig> => {
    return get<LLMConfig>("/app-config/llm");
  },

  previewSampling: (model: string, sampling: ModelSampling): Promise<Record<string, SamplingBudget>> =>
    post<Record<string, SamplingBudget>>("/app-config/llm/preview", {model, sampling}),

  getModels: (): Promise<ModelCatalog> => get<ModelCatalog>("/app-config/models"),

  updateLLMConfig: (config: Partial<LLMConfig>): Promise<LLMConfig> => {
    const { has_api_key: _hasApiKey, ...writable } = config;
    return post<LLMConfig>("/app-config/llm", writable);
  },

  /**
   * 获取 Agent 通用配置
   */
  getAgentConfig: (): Promise<AgentConfig> => {
    return get<AgentConfig>("/app-config/agent");
  },

  /**
   * 更新 Agent 通用配置
   */
  updateAgentConfig: (config: AgentConfig): Promise<AgentConfig> => {
    return post<AgentConfig>("/app-config/agent", config);
  },

  /**
   * 获取工具策略表与内置工具目录
   */
  getToolPolicy: (): Promise<ToolPolicyConfig> => {
    return get<ToolPolicyConfig>("/app-config/tool-policy");
  },

  /**
   * 整表替换工具策略；从下一次创建的执行任务起生效
   */
  updateToolPolicy: (rules: Record<string, ToolPolicy>): Promise<ToolPolicyConfig> => {
    return post<ToolPolicyConfig>("/app-config/tool-policy", { rules });
  },

  /**
   * 获取 MCP 服务器列表
   */
  getMCPServers: (): Promise<MCPServersData> => {
    return get<MCPServersData>("/app-config/mcp-servers");
  },

  /**
   * 新增 MCP 服务配置
   * @param config MCP 配置对象，格式为 { mcpServers: { [serverName]: MCPServerConfig } }
   */
  addMCPServer: (config: MCPConfig): Promise<void> => {
    return post<void>("/app-config/mcp-servers", config);
  },

  /**
   * 删除 MCP 服务
   */
  deleteMCPServer: (serverName: string): Promise<void> => {
    return post<void>(`/app-config/mcp-servers/${serverName}/delete`, {});
  },

  /**
   * 更新 MCP 启用状态
   */
  updateMCPServerEnabled: (
    serverName: string,
    enabled: boolean
  ): Promise<void> => {
    return post<void>(
      `/app-config/mcp-servers/${serverName}/enabled`,
      { enabled }
    );
  },

  /**
   * 获取 A2A 服务器列表
   */
  getA2AServers: (): Promise<A2AServersData> => {
    return get<A2AServersData>("/app-config/a2a-servers");
  },

  /**
   * 新增 A2A 服务器
   * @param params 包含 base_url 的请求参数
   */
  addA2AServer: (params: CreateA2AServerParams): Promise<void> => {
    return post<void>("/app-config/a2a-servers", params);
  },

  /**
   * 删除 A2A 服务
   */
  deleteA2AServer: (a2aId: string): Promise<void> => {
    return post<void>(`/app-config/a2a-servers/${a2aId}/delete`, {});
  },

  /**
   * 更新 A2A 启用状态
   */
  updateA2AServerEnabled: (
    a2aId: string,
    enabled: boolean
  ): Promise<void> => {
    return post<void>(
      `/app-config/a2a-servers/${a2aId}/enabled`,
      { enabled }
    );
  },
};

