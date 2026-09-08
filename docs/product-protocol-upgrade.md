# 主产品 MCP/A2A 协议升级实现说明

## 状态与目标

阶段 2 已于 2026-09-08 完成。主产品统一使用：

- MCP SDK `2.2.0`，协议版本 `2026-07-28`
- A2A SDK `1.1.2`，JSON-RPC 协议版本 `1.0`

完整运行证据、会话 ID 和命令见 [主产品协议验收记录](product-protocol-acceptance.md)。

## 实现边界

协议 SDK 仅存在于 `api/app/infrastructure/protocols/`。领域工具依赖
`api/app/domain/services/tools/protocol_gateway.py` 中的网关协议，不直接导入 MCP/A2A SDK 类型。`AgentTaskRunner` 在一次任务生命周期内初始化工具，并在成功、失败和取消路径的 `finally` 中清理连接。

应用配置服务负责 MCP/A2A 配置的持久化、启停、删除和用于 UI 的在线探测。协议连接、调用、超时、取消和响应归一化由基础设施实现负责。协议结果进入统一 `ToolResult` 和 `ProtocolToolContent`，以相同结构经过领域事件、数据库、SSE 和 UI 回放。

本次升级没有替换自研 Plan + ReAct 主循环，也没有引入通用重试中间件、流式 A2A、认证、OAuth、推送通知或 gRPC。

## MCP 最终实现

### 配置

MCP 支持两种 transport：

- `stdio`：`command`、`args`、`env`
- `streamable_http`：`url`、`headers`

配置包含 `enabled`、`call_timeout`；总发现预算由 `MCPConfig.discovery_budget` 控制。旧 `sse` transport 和不符合 transport 的字段组合会在 Pydantic 校验阶段被拒绝。

### 连接与发现

`MCPClientManager` 为每个启用的服务创建独立连接。客户端固定
`mode="2026-07-28"`，先发送 `server/discover`，校验目标版本后调用 SDK 的 `adopt`，不发送旧 `initialize` 握手。工具分页由 SDK 完成；单个服务失败不会阻止其他服务可用。

工具名由服务名、工具名和摘要组成，保留来源映射并限制在 64 字符内，避免名称归一化碰撞。禁用配置不创建连接、不做网络探测。

### 调用与清理

调用返回文本内容、结构化内容、`is_error`、`result_type` 和有限大小的非文本摘要。工具业务失败保持 `success=false`；超时、协议错误和无效响应具有稳定的 `error_kind`。

stdio 子进程、HTTP 客户端和 SDK context 均由 `AsyncExitStack` 管理。重复初始化前先清理，重复清理幂等；取消路径释放子进程和后台任务。

## A2A 最终实现

### 配置与卡片

每个 A2A 配置包含稳定 `id`、`base_url`、`enabled`、`call_timeout` 和
`cancel_timeout`。客户端通过官方 `A2ACardResolver` 获取卡片，只选择卡片中声明的
JSON-RPC 1.0 接口。旧卡片兼容由官方 resolver 负责；无 1.0 JSON-RPC 接口、仅 gRPC
接口或不支持的必选扩展会被标记为不可用。

发现采用并发隔离和总预算，单个服务失败不会阻止其他服务。禁用配置不读取 Agent Card。

### 调用状态机

一次用户调用只提交一次 `SendMessage`：

- 返回 `Message` 时直接归一化为成功结果。
- 返回 `Task` 时轮询同一个 Task ID，不重复发送原始消息。
- `COMPLETED` 为成功；`FAILED`、`REJECTED`、`CANCELED`、
  `INPUT_REQUIRED`、`AUTH_REQUIRED` 均保持失败语义。

本地取消和调用超时会在已获得 Task ID 时尽力发送远程取消，并以
`canceled`、`rejected`、`timeout` 或 `no_task_id` 记录取消结果。HTTP 客户端、
SDK 客户端和轮询任务在正常、失败和取消路径都被释放。

## 配置与前端契约

配置 API 保留离线条目，而不是把探测失败误解释为配置不存在：

- `connected`：服务可发现
- `unavailable`：配置存在但当前不可访问或协议不兼容
- `disabled`：配置已禁用且未探测

MCP 和 A2A 均支持新增、禁用/启用和删除。UI 设置页展示 transport、能力、连接状态和错误摘要；工具预览面板统一展示 `outcome.success`、`message` 和 `data`。前端类型已去除 MCP `sse`，并与后端枚举和结果模型一致。

## 持久化与兼容

协议成功、业务失败、超时、取消和空值数据均以 `ToolResult` 往返持久化。旧事件没有
`tool_content` 时仍按既有展示路径回放。协议升级不改变会话、附件和内置文件工具的存储结构。

依赖来源保持一致：`pyproject.toml` 和 `uv.lock` 是开发锁定依据，
`requirements.txt` 是容器安装来源。验收已确认导出内容一致、API/UI 镜像可构建，
容器内版本与锁定版本相同。

## 验证依据

- 自动化：`ray_agent/api/tests/protocols/` 和 `tests/core/`
- 用户路径：验收记录中的 U1–U6
- 技术门禁：验收记录中的 T1–T5
- labs 教学基线：`labs/foundations/README.md` 和 `labs/a2a/README.md`

后续阶段若调整协议版本、事件结构或配置模型，需要同时更新网关调用方、持久化/SSE
适配、前端类型、自动化契约测试和验收记录。
