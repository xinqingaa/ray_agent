# Docker 操作说明

本文说明本仓库产品 Compose 的启动、停止、重启和日志查看。配置项与首次部署条件见 [运行指南](README.md)。

命令均以**本目录**为工作目录。仓库根也叫 `ray_agent`，在仓库根执行 `docker compose` 会报找不到配置文件。

```bash
cd ray_agent
```

页面入口与部署配置见[运行指南](README.md)。下列命令使用 Compose 服务名；沙箱连接模式见[沙箱指南](sandbox/README.md#与-api-连接)。

## 看是否启动

```bash
docker compose ps
```

认 `STATUS` 是否带 `healthy`，不要认构建输出里的绿勾。API、UI、Postgres、Redis 应为 healthy；Nginx 应处于运行状态。

## 启动

```bash
# 首次，或改了代码 / Dockerfile / config.yaml
docker compose up -d --build

# 镜像已有，整套拉起
docker compose up -d
```

`-d` 在后台运行。启动后用 `docker compose ps` 确认，再打开 http://localhost:8088。

## 停止

```bash
# 停止全部容器，保留数据卷（会话、Redis、本地文件）
docker compose down

# 只停某一个
docker compose stop manus-api
```

不要使用 `docker compose down -v`，除非你明确要清空数据库和文件卷。

## 重启

`restart` 和 `up -d` 不一样。

| 目的 | 命令 |
|---|---|
| 进程重启，不重读 `.env` | `docker compose restart manus-api` |
| 只改了 `.env`（密钥、服务连接等） | `docker compose up -d --force-recreate --no-deps manus-api` |
| 改了 API 代码或 `config.yaml` | `docker compose up -d --build manus-api` |
| 整套重启 | `docker compose restart` |

只执行 `restart` 时，容器创建时写入的环境变量不会更新。模型名、地址与环境变量的区别见[模型与工具配置](README.md#模型与工具)。

## 看日志

每个容器把自己的标准输出交给 Docker，按服务名拉取。`Ctrl+C` 只停跟踪，不停容器。

| 看什么 | 命令 |
|---|---|
| 后端 / Agent / 模型调用 | `docker compose logs -f --tail=100 manus-api` |
| 谁访问了 `/api/.../chat` | `docker compose logs -f --tail=50 manus-nginx` |
| 前端页面报错 | `docker compose logs --tail=50 manus-ui` |
| 数据库**进程**（启动、崩溃） | `docker compose logs --tail=50 manus-postgres` |
| Redis 进程 | `docker compose logs --tail=50 manus-redis` |

三种不要混：

1. **构建输出**：`Building`、`CACHED`、`exporting`。只说明镜像编没编好。
2. **容器运行日志**：上表。问答时盯 `manus-api`。
3. **任务轨迹**：页面时间线，以及库里的 `sessions.events`。Postgres 容器日志不会打出「规划了几步」或工具名。

按会话过滤后端日志：

```bash
docker compose logs --since 30m manus-api 2>&1 | grep 会话
```

把 `会话` 换成页面地址栏里的会话 id，可只看这一次问答。

需要调整日志详细程度或 SQL 输出时，按[服务环境配置](README.md#服务环境)修改，再按上节重建 API 容器。

## 常见现象

| 现象 | 先看 |
|---|---|
| `no configuration file provided` | 当前目录是不是内层 `ray_agent/` |
| 构建成功但页面打不开 | `docker compose ps`，再看 `manus-nginx` / `manus-api` |
| API 不是 healthy | `docker compose logs --tail=80 manus-api` |
| 配置修改未生效 | 先核对[配置位置](README.md#模型与工具)，再按上表选择重建容器或镜像 |
