# Docker 操作说明

本文说明本仓库产品 Compose 的启动、停止、重启和日志查看。配置项与首次部署条件见 [运行指南](README.md)。

命令均以**本目录**为工作目录。仓库根也叫 `ray_agent`，在仓库根执行 `docker compose` 会报找不到配置文件。

```bash
cd ray_agent
```

本机路径即 `/Users/lrq/work/ray_agent/ray_agent` 时：

```bash
cd /Users/lrq/work/ray_agent/ray_agent
```

不要把终端里的提示符或 `[+]` 进度条粘进命令。zsh 会把 `[+]` 当成通配符。

## 谁在跑、端口在哪

| 容器名 | 角色 | 你在 Mac 上怎么访问 |
|---|---|---|
| `manus-nginx` | 总入口 | **http://localhost:8088**（`.env` 的 `NGINX_PORT`） |
| `manus-ui` | 前端 | 容器内 3000，不映射到本机 |
| `manus-api` | 后端 | 容器内 8000，页面经 Nginx 的 `/api/` 转发 |
| `manus-postgres` | 数据库 | 容器内 5432，不映射到本机 |
| `manus-redis` | 任务队列 | 容器内 6379，不映射到本机 |
| `manus-sandbox` | 沙箱镜像/常驻容器 | 任务时 API 还会动态创建 `rayagent-sandbox-*` |

浏览器只开 8088。不必再找 3000、8000、5432。

## 看是否启动

```bash
docker compose ps
```

认 `STATUS` 是否带 `healthy`，不要认构建输出里的绿勾。API、UI、Postgres、Redis 应为 healthy；Nginx 显示 `Started` 即可。

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
| 只改了 `.env`（模型、Key、地址） | `docker compose up -d --force-recreate --no-deps manus-api` |
| 改了 API 代码或 `config.yaml` | `docker compose up -d --build manus-api` |
| 整套重启 | `docker compose restart` |

只执行 `restart` 时，容器创建时写入的环境变量不会更新。换模型后容器里仍是旧值，就是这个原因。

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

`ENV=development` 不再自动回显全部 SQL。需要查 SQL 时在 `.env` 设 `SQLALCHEMY_ECHO=1`，再按上一节重建 API 容器。

API 启动正常时，`manus-api` 日志里应能看到 `日志系统初始化完成 ... sqlalchemy_echo=False`，以及 `app.infrastructure.storage` 的 Redis/Postgres 初始化行。问答时应出现带 `会话[id]` 的 Planner / LLM 摘要，而不是刷屏 SELECT。日常使用 `.env` 的 `LOG_LEVEL=INFO`；健康检查不会再每 15 秒打一条 INFO。

## 常见现象

| 现象 | 先看 |
|---|---|
| `no configuration file provided` | 当前目录是不是内层 `ray_agent/` |
| 构建成功但页面打不开 | `docker compose ps`，再看 `manus-nginx` / `manus-api` |
| API 不是 healthy | `docker compose logs --tail=80 manus-api` |
| 换了模型或 Key 没生效 | 是不是只用了 `restart`，应 `up -d --force-recreate --no-deps manus-api` |
| `zsh: no matches found: [+]` | 不要粘贴 Compose 进度条 |
