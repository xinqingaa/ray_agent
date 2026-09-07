# RayAgent 运行指南

本文说明完整应用的配置、部署和运行检查。产品能力见 [项目首页](../README.md)，执行与数据流见 [架构说明](../docs/architecture.md)。

以下说明已对照部署配置和启动代码核对，完整部署及任务执行仍待验证。

## 环境要求

- Docker Engine 或 Docker Desktop，以及 Docker Compose 插件。
- 可访问镜像仓库和构建所需的软件源。
- 支持工具调用的模型服务，其地址、模型名称与 API Key。
- 腾讯云 COS 存储桶及访问配置，用于附件和浏览器截图。

采用动态沙箱时，API 通过 Docker Socket 管理容器。部署主机需提供相应访问权限和可用资源；动态与已有沙箱的选择见 [沙箱连接方式](sandbox/README.md#与-api-连接)。

## 配置

以下路径与命令均以本目录为工作目录。从仓库根进入：

```bash
cd ray_agent
```

### 服务环境

在本目录创建 `.env`，字段可参考 [API 环境示例](api/.env.example)。Compose 会把此文件中的环境变量传入 API 容器。

按 [docker-compose.yml](docker-compose.yml) 配置服务连接：

| 配置项 | Compose 部署取值或要求 |
|---|---|
| `APP_CONFIG_FILEPATH` | `config.yaml` |
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
| `COS_SECRET_ID` / `COS_SECRET_KEY` | COS 访问凭据 |
| `COS_REGION` / `COS_BUCKET` | 存储桶实际地域与名称 |
| `COS_SCHEME` | `https` |
| `NGINX_PORT` | 对外端口，默认 `8088` |

表中的服务名、镜像名和网络名对应实际 Compose 标识。API 容器连接数据库和 Redis 时使用服务名，不能用指向容器自身的 `localhost`。环境示例中的 Redis 端口、沙箱镜像和网络需按上表调整。

`.env` 已被 Git 忽略，各设备分别准备凭据与本地配置。

### 模型与工具

在 [api/config.yaml](api/config.yaml) 的 `llm_config` 中填写：

| 字段 | 内容 |
|---|---|
| `base_url` | 模型 API 地址 |
| `api_key` | 模型服务凭据 |
| `model_name` | 服务支持的模型名称 |

首次验证先使用内置工具。在 `api/config.yaml` 中将以下两段配置替换为空集合，保留 `llm_config` 和 `agent_config`；这样无需连接外部 MCP/A2A 服务：

```yaml
mcp_config:
  mcpServers: {}
a2a_config:
  a2a_servers: []
```

后续启用外部服务时，再填写对应配置并确认地址可达。仅启动页面不会验证这些服务，任务执行时才会初始化相关工具。

此文件由 Git 跟踪，填写真实凭据后需要检查差异，避免将凭据加入提交。容器构建会复制该文件；修改后需要重新构建 API 镜像。

## 启动与验证

先确认 Docker CLI、Compose 插件和引擎可用，再检查部署配置：

```bash
docker --version
docker compose version
docker info
docker compose config --quiet
```

最后一条命令需先创建本目录 `.env`，只校验 Compose 配置，不验证模型、COS 或外部服务凭据。检查通过后启动：

```bash
docker compose up -d --build
docker compose ps
```

打开 [http://localhost:8088](http://localhost:8088)。如果设置了 `NGINX_PORT`，使用对应端口。

首次启动会构建 API、UI 和沙箱镜像。API 启动时执行数据库迁移，再初始化 Redis、PostgreSQL 和 COS。API 就绪后，UI 和网关才会按依赖条件启动。

检查顺序：

1. 查看服务状态和日志，确认 API 初始化成功。
2. 访问页面，创建会话并发起任务。
3. 使用不需要外部搜索或协议服务的任务，例如“在沙箱工作目录创建一个文本文件，写入 hello，再读取并告诉我内容”，观察计划、实际工具调用和最终结果。
4. 刷新页面，检查会话历史。
5. 使用附件或浏览器功能时，检查文件传输与截图展示。

## 日常操作

```bash
# 查看服务日志
docker compose logs --tail=100

# 持续查看日志
docker compose logs -f

# 停止应用并保留数据卷
docker compose down
```

## 排查入口

| 现象 | 优先检查 |
|---|---|
| API 无法启动 | 数据库连接、迁移日志、Redis 和 COS 配置 |
| UI 或网关等待启动 | API 健康状态与日志 |
| 创建任务失败 | Docker Socket、沙箱镜像、容器网络和浏览器连接 |
| 模型调用失败 | API 地址、凭据、模型名称与工具调用支持 |
| 附件或截图失败 | COS 地域、存储桶、访问权限及沙箱文件操作 |

## 开发入口

各服务使用独立的依赖和运行环境：

- [API](api/README.md)：FastAPI、数据库迁移和后端分层。
- [UI](ui/README.md)：Next.js 前端。
- [沙箱](sandbox/README.md)：浏览器、终端和文件操作服务。

各服务 README 分别维护本地开发、依赖安装和验证命令；本指南只维护完整部署的配置与运行检查。
