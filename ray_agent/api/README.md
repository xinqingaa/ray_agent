# RayAgent API 开发指南

API 使用 FastAPI、Pydantic、SQLAlchemy 和 Alembic，负责会话、Agent 执行及外部能力接入。整体职责与执行流程见 [架构说明](../../docs/architecture.md)，完整应用部署见 [运行指南](../README.md)。

以下命令在 `ray_agent/api/` 执行，依据配置与代码整理，尚未完成运行验证。

## 依赖与配置

需要 Python 3.12+ 和 uv。安装包含测试工具的锁定依赖：

```bash
uv sync --locked --group dev
```

依赖由 [pyproject.toml](pyproject.toml) 声明、[uv.lock](uv.lock) 锁定；[Dockerfile](Dockerfile) 从 [requirements.txt](requirements.txt) 安装。升级时同步核对三者，本地开发不另维护一套手工安装版本。

本地 API 从当前目录 `.env` 加载环境变量，字段定义见 [core/config.py](core/config.py)，示例见 [.env.example](.env.example)。模型、Agent 与外部服务配置见 [config.yaml](config.yaml)。后者是已跟踪文件，实际凭据应留在本地。

在宿主机运行 API 前，先准备可访问的 PostgreSQL、Redis、COS，以及沙箱与浏览器连接：

- 数据库和 Redis 地址必须从 API 所在环境可达。产品 Compose 没有将这两项服务端口映射到宿主机，不能仅将地址改成 `localhost` 就连接容器服务。
- 动态沙箱需要 Docker 访问权限；已有沙箱需要可达的服务与浏览器端点。连接方式见 [沙箱指南](../sandbox/README.md#与-api-连接)。
- 当前浏览器适配连接沙箱中的浏览器，单独在宿主机安装浏览器不能替代沙箱准备。

## 启动与接口

```bash
uv run --locked uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

启动时会执行数据库迁移，再初始化 Redis、PostgreSQL 和 COS。接口说明由应用生成：启动后访问 [OpenAPI 文档](http://localhost:8000/docs)，无需另外维护完整路由表。

容器部署从产品目录 `ray_agent/` 运行，使用该目录的 `.env`；它与本地 API 目录中的 `.env` 是两个配置位置。

## 代码导航

以下路径相对于本目录的 `app/`：

| 问题 | 入口 |
|---|---|
| 应用生命周期与依赖组装 | `main.py`、`interfaces/service_dependencies.py` |
| 会话请求与任务准备 | `interfaces/endpoints/session_routes.py`、`application/services/agent_service.py` |
| 规划、模型循环与提示词 | `domain/services/flows/`、`domain/services/agents/`、`domain/services/prompts/` |
| 工具声明与协议适配 | `domain/services/tools/` |
| 事件模型与 SSE 映射 | `domain/models/event.py`、`interfaces/schemas/event.py` |
| 数据访问与工作单元 | `domain/repositories/`、`infrastructure/repositories/`、`infrastructure/models/` |
| 外部服务与执行资源 | `domain/external/`、`infrastructure/external/` |

## 测试与数据库迁移

```bash
uv run --locked python -m pytest
```

测试配置见 [pytest.ini](pytest.ini)。[conftest.py](tests/conftest.py) 使用 `TestClient` 进入应用生命周期，会执行迁移并初始化外部服务；先准备独立的测试数据库和相应配置。当前用例主要检查状态接口，不覆盖 Agent 完整执行和协议兼容性。

数据库结构变化时核对领域模型、ORM 转换与迁移文件：

```bash
uv run --locked alembic revision --autogenerate -m "描述本次结构变化"
uv run --locked alembic upgrade head
```

生成后检查迁移内容再应用。接口或事件变化还需验证客户端解析；任务与协议变化需运行对应真实流程，不能只依赖状态接口测试。

## 排查入口

启动失败先查看生命周期日志和服务连接；任务创建失败沿任务准备与沙箱适配追踪；事件展示问题同时检查 SSE 映射和前端解析。整体服务检查方法见 [运行指南](../README.md#排查入口)。
