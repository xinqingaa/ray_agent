# RayAgent 运行指南

本文说明完整应用的配置、部署和运行检查。产品能力见 [项目首页](../README.md)，执行与数据流见 [架构说明](../docs/architecture.md)。

以下说明已对照部署配置和启动代码核对；项目运行验收见 [执行计划](../PLAN.md)，课程任务的具体观察与验证范围见 [制作进度](../lessons/progress.md)。

## 环境要求

- Docker Engine 或 Docker Desktop，以及 Docker Compose 插件。
- 可访问镜像仓库和构建所需的软件源。
- 支持工具调用的模型服务，其地址、模型名称与 API Key。
- 附件和截图的文件存储：默认本地磁盘；使用腾讯云 COS 时再准备存储桶及访问配置。

采用动态沙箱时，API 通过 Docker Socket 管理容器。部署主机需提供相应访问权限和可用资源；动态与已有沙箱的选择见 [沙箱连接方式](sandbox/README.md#与-api-连接)。

## 配置

以下路径与命令均以本目录为工作目录。从仓库根进入：

```bash
cd ray_agent
```

### 服务环境

在本目录创建 `.env`，字段可参考 [环境示例](.env.example)。Compose 会把此文件中的环境变量传入 API 容器。

按 [docker-compose.yml](docker-compose.yml) 配置服务连接：

| 配置项 | Compose 部署取值或要求 |
|---|---|
| `APP_CONFIG_FILEPATH` | `config.yaml` |
| `LLM_API_KEY` | 模型服务凭据；不要写进已跟踪的 `config.yaml` |
| `LLM_MODEL_NAME` | 支持工具调用的模型名称，例如 `deepseek-chat` |
| `LLM_BASE_URL` | 兼容 OpenAI 的接口地址，DeepSeek 为 `https://api.deepseek.com/` |
| `LLM_TEMPERATURE` | 采样温度，例如 `0.7` |
| `LLM_MAX_TOKENS` | 单次回复最大输出 token，例如 `8192` |
| `LOG_LEVEL` | API 日志等级，例如 `INFO` 或 `DEBUG` |
| `SQLALCHEMY_ECHO` | `1` 时在 API 日志中回显 SQL；默认关闭 |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | 数据库初始化设置；与下面的连接 URI 一致 |
| `SQLALCHEMY_DATABASE_URI` | `postgresql+asyncpg://<用户>:<密码>@manus-postgres:5432/<数据库>` |
| `REDIS_HOST` / `REDIS_PORT` | `manus-redis` / `6379` |
| `REDIS_DB` | `0` |
| `REDIS_PASSWORD` | 当前 Redis 服务未设置密码，可不配置此项 |
| `SANDBOX_IMAGE` | `manus-sandbox` |
| `SANDBOX_NETWORK` | `manus-network` |
| `SANDBOX_NAME_PREFIX` | 动态容器名称前缀，例如 `rayagent-sandbox` |
| `SANDBOX_TTL_MINUTES` | 沙箱存活时间，例如 `60` |
| `SANDBOX_ADDRESS` | 使用动态沙箱时不设置此项 |
| `FILE_STORAGE_BACKEND` | `local`（默认，写本地磁盘）或 `cos`（腾讯云对象存储） |
| `FILE_STORAGE_LOCAL_DIR` | 本地模式的目录；Compose 部署使用 `/data/files` |
| `COS_SECRET_ID` / `COS_SECRET_KEY` | 仅 `FILE_STORAGE_BACKEND=cos` 时必填 |
| `COS_REGION` / `COS_BUCKET` | 仅云端模式需要，填存储桶地域与名称 |
| `COS_SCHEME` | `https` |
| `NGINX_PORT` | 对外端口，默认 `8088` |

表中的服务名、镜像名和网络名对应实际 Compose 标识。API 容器连接数据库和 Redis 时使用服务名，不能用指向容器自身的 `localhost`。环境示例中的 Redis 端口、沙箱镜像、网络和本地文件目录需按上表调整。本地模式不需要填写 COS 凭据；Compose 部署请使用 `FILE_STORAGE_LOCAL_DIR=/data/files`，与 API 数据卷对应。选择 `cos` 时缺项会导致 API 无法启动。

`.env` 已被 Git 忽略，各设备分别准备凭据与本地配置。

### 模型与工具

模型调用使用 OpenAI 兼容的 Chat Completions 协议。LLM 字段一律写在本目录 `.env` 的 `LLM_*`：`LLM_API_KEY`、`LLM_MODEL_NAME`、`LLM_BASE_URL`、`LLM_TEMPERATURE`、`LLM_MAX_TOKENS`。[api/config.yaml](api/config.yaml) 只保留未填环境变量时的回落默认值。加载时 `.env` 覆盖 yaml；写回时不会把覆盖值落盘。首次验证使用内置工具即可，仓库中的 MCP/A2A 配置已是空集合。启用外部 MCP/A2A、以及本地验收夹具的步骤见 [API 开发指南](api/README.md#mcpa2a)。仅启动页面不会验证这些服务，任务执行时才会初始化相关工具。

`config.yaml` 由 Git 跟踪，不要写入真实凭据。修改该文件后需要重新构建 API 镜像。只改 `.env` 时必须重建 API 容器才能读到新值，`docker compose restart` 不会重读环境变量。具体命令见 [Docker 操作说明](DOCKER.md)。

## 启动与验证

先确认 Docker CLI、Compose 插件和引擎可用，再检查部署配置：

```bash
docker --version
docker compose version
docker info
docker compose config --quiet
```

最后一条命令需先创建本目录 `.env`，只校验 Compose 配置，不验证模型、文件存储凭据或外部服务。检查通过后启动：

```bash
docker compose up -d --build
docker compose ps
```

打开 [http://localhost:8088](http://localhost:8088)。如果设置了 `NGINX_PORT`，使用对应端口。

首次启动会构建 API、UI 和沙箱镜像。API 启动时执行数据库迁移，再初始化 Redis、PostgreSQL，并按 `FILE_STORAGE_BACKEND` 初始化本地目录或 COS。API 就绪后，UI 和网关才会按依赖条件启动。

检查顺序：

1. 查看服务状态和日志，确认 API 初始化成功。
2. 访问页面，创建会话并发起任务。
3. 使用不需要外部搜索或协议服务的任务，例如“在沙箱工作目录创建一个文本文件，写入 hello，再读取并告诉我内容”，观察计划、实际工具调用和最终结果。
4. 刷新页面，检查会话历史。
5. 使用附件或浏览器功能时，检查文件传输与截图展示。

## 日常操作

启动、停止、重启、查看状态和日志见 [Docker 操作说明](DOCKER.md)。不要在仓库根执行 `docker compose`。

## 排查入口

| 现象 | 优先检查 |
|---|---|
| API 无法启动 | 数据库连接、迁移日志、Redis；`FILE_STORAGE_BACKEND=cos` 时检查 COS 配置 |
| UI 或网关等待启动 | API 健康状态与日志 |
| 创建任务失败 | Docker Socket、沙箱镜像、容器网络和浏览器连接 |
| 模型调用失败 | API 地址、凭据、模型名称与工具调用支持 |
| 附件或截图失败 | 本地目录与数据卷，或 COS 地域、存储桶、访问权限，以及沙箱文件操作 |

## 开发入口

各服务使用独立的依赖和运行环境：

- [API](api/README.md)：FastAPI、数据库迁移和后端分层。
- [UI](ui/README.md)：Next.js 前端。
- [沙箱](sandbox/README.md)：浏览器、终端和文件操作服务。

各服务 README 分别维护本地开发、依赖安装和验证命令；本指南只维护完整部署的配置与运行检查。
