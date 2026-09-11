# RayAgent API 开发指南

API 使用 FastAPI、Pydantic、SQLAlchemy 和 Alembic，负责会话、Agent 执行及外部能力接入。整体职责与执行流程见 [架构说明](../../docs/architecture.md)，完整应用部署见 [运行指南](../README.md)。

以下命令在 `ray_agent/api/` 执行。

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

## MCP/A2A

仓库里的 [config.yaml](config.yaml) 保持空集合，供镜像默认值和 Git 使用。

pytest 会自己拉起临时协议服务，不依赖本机 9911/9912，也不能代替页面验收：

```bash
uv run --locked python -c 'from importlib.metadata import version; print({p: version(p) for p in ["mcp", "a2a-sdk"]})'
uv export --locked --format requirements-txt --no-dev -o requirements.txt
uv run --locked python -m pytest tests/protocols tests/core
```

### 怎么接到产品里

对端必须先在跑，并且协议一致：MCP `2026-07-28`（`stdio` 或 `streamable_http`），A2A 1.0 JSON-RPC。产品只做发现、调用和结果展示；不提供 OAuth、MCP resources、A2A 多轮人工续接。

日常在**首页右上角齿轮**（标题「RayAgent 设置」）添加，不要改仓库 yaml：

1. 打开 http://localhost:8088/ 。会话详情页没有设置按钮。
2. 「MCP 服务器」或「A2A Agent 配置」→ 添加。
3. 开关打开后才会探测。对端没起来会显示「不可用」，配置仍会留下。
4. Compose 里的 API 读写容器内 `/app/config.yaml`，没有挂载仓库文件；手改 `ray_agent/api/config.yaml` 不会立刻生效。查看运行中配置：`docker compose exec -T manus-api cat /app/config.yaml`（在 `ray_agent/` 执行）。
5. Docker Desktop 中的 API 访问宿主机用 `host.docker.internal`，不要填容器自己的 `127.0.0.1`。API 跑在宿主机时用 `127.0.0.1`。
6. stdio 的 MCP 必须写 `transport: stdio` 和 `command`；省略 `args`/`env` 分别为 `[]`/`{}`。旧 MCP `sse` 已移除，页面任务事件 SSE 不受影响。
7. 工具失败可能让当前任务整轮结束；连测时把故意失败的步骤放在最后。
8. 真实凭据只写运行中配置或未跟踪文件，不要提交进仓库。

线上用法是连接已经部署、协议一致的服务，不需要起下面的验收夹具。

### 本地页面验收

夹具只提供加法、固定回复和固定失败，不是生产服务。产品 Compose 保持运行，然后：

```bash
./scripts/run-protocol-fixtures.sh start          # API 在 Docker Desktop
./scripts/run-protocol-fixtures.sh start --local  # API 在宿主机
./scripts/run-protocol-fixtures.sh status
./scripts/run-protocol-fixtures.sh stop
```

`start` 会打印设置里应粘贴的地址。添加后两项应为「已连接」，MCP 能看到 `add`。新建任务验证调用，不要发在旧会话里。做完：设置里删除临时项，再 `stop`。不要把 `9911`/`9912` 写进仓库 yaml。

每个服务可设 `connect_timeout`、`discovery_timeout`、`call_timeout`（秒），A2A 另有 `cancel_timeout`；配置根节点有 `discovery_budget`。静态认证用 `headers`，stdio 环境用 `env`。
