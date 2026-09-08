# 主产品 MCP/A2A 协议验收记录

## 验收结论

验收日期：2026-09-08。

主产品已固定 `mcp==2.2.0` 和 `a2a-sdk==1.1.2`，完成 MCP `2026-07-28`、A2A 1.0 JSON-RPC、前后端配置与结果展示、失败语义、持久化回放和资源清理验证。U1–U6、T1–T5 均通过；UI 全量 lint 的既有问题单独记录，不影响 production build 和本阶段“不新增违规”的结论。

验收使用的临时 MCP/A2A 配置已删除，宿主机配置已恢复，端口 `9888`、`9911`、`9912`、`9999` 均无遗留监听进程。

## 主产品用户路径

### U1：MCP 成功调用

- 会话：`098c03ee-4647-4b61-af2a-28932792942f`
- 调用 acceptance MCP 的 `add`，参数 `a=17`、`b=25`。
- 持久化结果为 `success=true`，文本与 `structured_content.result` 均为 `42`。
- 对端日志记录一次 `add` 调用。

### U2：A2A Message 回复

- 会话：`3ea5b4d7-ff40-4feb-8dc5-8d57d9b55623`
- 通过 Agent Card 选择 JSON-RPC 1.0 接口，仅提交一次 `ray-agent-a2a-check`。
- 对端回复 `A2A_OK:ray-agent-a2a-check`，持久化 `remote_state=message`。
- 对端日志仅有该输入的一次 `SendMessage`，请求头协议版本为 `1.0`。

### U3：A2A Task 轮询

- 会话：`1040c645-a1c3-4c06-8e5c-7fc0bbfb07c4`
- 仅提交一次 `delay`，随后通过 `GetTask` 轮询同一任务。
- 最终 `remote_state=completed`，产物为 `A2A_ARTIFACT_OK`。
- Task ID：`d7f2237d-e745-4efe-acfa-aaa68fa70108`。
- 对端日志顺序为一次 `SendMessage`、一次 `GetTask`，没有重复提交。

### U4：协议失败状态

- 会话：`36fa4ec3-7c2a-45f2-9869-7e64b7198a7f`
- MCP `fail` 返回 `success=false`、`MCP_EXPECTED_FAILURE`、`error_kind=tool_error`。
- A2A `fail` 返回 `success=false`、`remote_state=failed`、`A2A_EXPECTED_FAIL`、`error_kind=remote_state`。
- 两类失败均按失败持久化和回放，没有被 UI 或 SSE 转换为成功。

### U5：内置文件工具回归

- 会话：`ce451101-1cc6-4480-8b4f-fbf0f0b7ac2c`
- `write_file` 和 `read_file` 均被真实调用，读回内容为 `hello`。
- `wc -c` 为 `5`，`od -c` 无换行；附件 `hello.txt` 的持久化 `size` 为 `5`。
- 该项确认协议升级没有破坏内置文件工具和附件交付。

### U6：离线配置管理

- 停止 acceptance MCP/A2A 服务后，两个配置仍可列出，状态均为 `unavailable`。
- 离线配置均可禁用，随后状态均为 `disabled`。
- 在服务重新监听后重复读取配置，协议日志行数保持 `before=1`、`after=1`，证明禁用项未被探测。
- 两个离线配置均可删除；最终 API 返回 `mcp_servers=[]`、`a2a_servers=[]`。

## 技术门禁

### T1：依赖、锁文件与导入

执行：

```bash
cd ray_agent/api
uv lock --check
uv export --locked --format requirements-txt --no-dev
uv run --locked python -c "from importlib.metadata import version; print(version('mcp'), version('a2a-sdk'))"
```

结果：退出码 `0`；锁定版本为 `mcp 2.2.0`、`a2a-sdk 1.1.2`。导出内容去除自动生成命令注释后与 `requirements.txt` 完全一致，应用导入成功。

### T2：协议与核心自动化测试

执行：

```bash
cd ray_agent/api
PYTHONDONTWRITEBYTECODE=1 uv run --locked python -m pytest -p no:cacheprovider tests/protocols tests/core
```

结果：退出码 `0`，`56 passed`。覆盖目标 SDK 版本、MCP HTTP/stdio、A2A Message/Task、超时/取消、失败语义、禁用不探测、离线配置管理、事件往返和资源清理。

### T3：容器构建与运行

执行：

```bash
cd ray_agent
docker compose build manus-api manus-ui
docker compose up -d manus-api manus-ui manus-nginx
docker compose ps
docker compose exec -T manus-api python -c "from importlib.metadata import version; from app.main import app; print(app.title, version('mcp'), version('a2a-sdk'))"
```

结果：API/UI 镜像构建退出码 `0`，API 和 UI 均为 `healthy`；容器输出 `MoocManus通用智能体 2.2.0 1.1.2`。`/api/status` 中 PostgreSQL、Redis 均为 `ok`。

### T4：前端构建与 lint 基线

执行：

```bash
cd ray_agent/ui
npm run build
npm run lint
```

结果：production build 退出码 `0`，类型检查和页面生成通过。全量 lint 仍为既有基线 `14 errors, 22 warnings`，主要来自 refs、effect 中同步 setState、render 中动态组件和 `Math.random`；本阶段修改的 labs、测试和文档没有新增 UI lint 项。

### T5：labs 可复现基线

MCP：

```bash
cd labs/foundations
uv lock --check
uv run --locked python 6_7_mcp-client-demo.py
uv run --locked python 6_7_mcp-client-with-exit-stack.py
uv run --locked python 6_9_mcp-code.py
uv run --locked python 6_9_mcp-client.py
```

结果：锁定 `mcp 2.2.0`；stdio 两种生命周期写法均发现 `calculator` 并返回 `42`；Streamable HTTP 客户端发现 `run_code` 并返回 `42`。

A2A：

```bash
cd labs/a2a
uv lock --check
uv run --locked python main.py
uv run --locked python client.py
uv run --locked python httpx_a2a.py
```

结果：锁定 `a2a-sdk 1.1.2`；SDK 客户端和手写 1.0 JSON-RPC 客户端均读取同一卡片，并收到 `A2A_LAB_OK:ray-agent-lab`。

## 已知非阻塞项

- UI 全量 lint 基线未在协议阶段顺带重构，production build 已通过。
- pytest 报告 `cache_dir` 未知选项和既有 Pydantic 弃用警告，不影响测试结果。
- 外部高德、百度、LLMOPS、模型密钥示例和 `foundations/2-2 code/` 历史综合示例不属于本次可复现通过条件。
