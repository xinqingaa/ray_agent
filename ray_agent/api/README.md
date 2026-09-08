# RayAgent API 开发指南

API 使用 FastAPI、Pydantic、SQLAlchemy 和 Alembic，负责会话、Agent 执行及外部能力接入。整体职责与执行流程见 [架构说明](../../docs/architecture.md)，完整应用部署见 [运行指南](../README.md)。

以下命令在 `ray_agent/api/` 执行。各轮实际执行条件与结果见项目验收记录。

## 依赖与配置

需要 Python 3.12+ 和 uv。安装包含测试工具的锁定依赖：

```bash
uv sync --locked --group dev
```

依赖由 [pyproject.toml](pyproject.toml) 声明、[uv.lock](uv.lock) 锁定；[Dockerfile](Dockerfile) 从 [requirements.txt](requirements.txt) 安装。升级时同步核对三者，本地开发不另维护一套手工安装版本。

本地 API 从当前目录 `.env` 加载环境变量，字段定义见 [core/config.py](core/config.py)，示例见 [.env.example](.env.example)。LLM 使用 `LLM_API_KEY`、`LLM_MODEL_NAME`、`LLM_BASE_URL`、`LLM_TEMPERATURE`、`LLM_MAX_TOKENS`；Agent / MCP / A2A 仍见 [config.yaml](config.yaml)。不要把密钥写入已跟踪的 yaml。

在宿主机运行 API 前，先准备可访问的 PostgreSQL、Redis、文件存储，以及沙箱与浏览器连接：

- 数据库和 Redis 地址必须从 API 所在环境可达。产品 Compose 没有将这两项服务端口映射到宿主机，不能仅将地址改成 `localhost` 就连接容器服务。
- 动态沙箱需要 Docker 访问权限；已有沙箱需要可达的服务与浏览器端点。连接方式见 [沙箱指南](../sandbox/README.md#与-api-连接)。
- 当前浏览器适配连接沙箱中的浏览器，单独在宿主机安装浏览器不能替代沙箱准备。
- 文件存储由 `FILE_STORAGE_BACKEND` 决定：默认 `local` 写入本地目录；`cos` 才需要腾讯云凭据，启动时会校验必填项。

## 启动与接口

```bash
uv run --locked uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

启动时会执行数据库迁移，再初始化 Redis、PostgreSQL，并按配置初始化本地文件目录或 COS。接口说明由应用生成：启动后访问 [OpenAPI 文档](http://localhost:8000/docs)，无需另外维护完整路由表。

容器部署从产品目录 `ray_agent/` 运行，使用该目录的 `.env`；它与本地 API 目录中的 `.env` 是两个配置位置。

## 代码导航

以下路径相对于本目录的 `app/`：

| 问题 | 入口 |
|---|---|
| 应用生命周期与依赖组装 | `main.py`、`interfaces/service_dependencies.py` |
| 会话请求与任务准备 | `interfaces/endpoints/session_routes.py`、`application/services/agent_service.py` |
| 规划、模型循环与提示词 | `domain/services/flows/`、`domain/services/agents/`、`domain/services/prompts/` |
| 工具声明与协议适配 | `domain/services/tools/`、`infrastructure/protocols/` |
| 事件模型与 SSE 映射 | `domain/models/event.py`、`interfaces/schemas/event.py` |
| 数据访问与工作单元 | `domain/repositories/`、`infrastructure/repositories/`、`infrastructure/models/` |
| 外部服务与执行资源 | `domain/external/`、`infrastructure/external/` |

## 测试与数据库迁移

```bash
uv run --locked python -m pytest
```

测试配置见 [pytest.ini](pytest.ini)。纯核心与协议用例不会启动应用或连接数据库。只有使用 [conftest.py](tests/conftest.py) 中 `client` fixture 的接口测试会进入应用生命周期、迁移和初始化外部服务，运行它们前需准备独立的测试数据库与 Redis 配置。协议自动测试不能替代真实模型的页面验收。

数据库结构变化时核对领域模型、ORM 转换与迁移文件：

```bash
uv run --locked alembic revision --autogenerate -m "描述本次结构变化"
uv run --locked alembic upgrade head
```

生成后检查迁移内容再应用。接口或事件变化还需验证客户端解析；任务与协议变化需运行对应真实流程，不能只依赖状态接口测试。

## 排查入口

启动失败先查看生命周期日志和服务连接；任务创建失败沿任务准备与沙箱适配追踪；事件展示问题同时检查 SSE 映射和前端解析。Compose 启停与按服务查看日志见 [Docker 操作说明](../DOCKER.md)，整体检查入口见 [运行指南](../README.md#排查入口)。

## MCP/A2A 开发与验收

版本、协议边界和验收条件统一维护在 [协议升级说明](../../docs/product-protocol-upgrade.md)。安装后核对与导出：

```bash
uv run --locked python -c 'from importlib.metadata import version; print({p: version(p) for p in ["mcp", "a2a-sdk"]})'
uv export --locked --format requirements-txt --no-dev -o requirements.txt
uv run --locked python -m pytest tests/protocols tests/core
```

协议测试会自动启动本地 HTTP/stdio 服务，使用临时目录保存日志，结束后回收子进程，不依赖 labs、模型密钥或日常数据库。确定性 A2A 测试端点使用官方消息类型和 ProtoJSON 序列化，并故意提供错误响应，用于覆盖客户端边界；它不是对外提供的生产 A2A 服务端。

在两个终端启动页面验收服务：

```bash
RAY_PROTOCOL_LOG=/tmp/ray-protocol-acceptance.jsonl uv run --locked python tests/protocols/fixture_server.py mcp --port 9911
```

```bash
RAY_PROTOCOL_LOG=/tmp/ray-protocol-acceptance.jsonl uv run --locked python tests/protocols/fixture_server.py a2a --port 9912 --public-url http://host.docker.internal:9912
```

以上公布地址供 Docker Desktop 中的产品 API 使用。API 在宿主机运行时，把 A2A `--public-url` 改为 `http://127.0.0.1:9912`。卡片公布的调用端点与获取卡片的地址都必须从 API 可达。

页面 MCP 设置中添加：

```json
{"mcpServers":{"acceptance":{"transport":"streamable_http","url":"http://host.docker.internal:9911/mcp"}}}
```

页面 A2A 设置添加 `http://host.docker.internal:9912`。执行验收后删除临时设置并停止两个终端进程。不要覆盖已有服务配置。测试服务仅限本地验收，它们没有生产认证。

MCP stdio 配置必须显式选择 `transport: stdio` 并提供 `command`；省略 `args`、`env` 分别使用 `[]`、`{}`，显式 null 无效。旧 MCP `sse` 传输已移除，页面任务事件 SSE 不受影响。

`config.yaml` 的每个 MCP/A2A 服务可以设置 `connect_timeout`、`discovery_timeout`、`call_timeout`（秒），A2A 另有 `cancel_timeout`。两个协议配置根节点均有 `discovery_budget`。静态认证通过服务 `headers` 配置；stdio 环境通过 `env` 配置。只在本地未跟踪配置中写入真实凭据，勿提交到仓库。
