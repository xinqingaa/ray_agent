# RayAgent API 开发指南

API 使用 FastAPI、Pydantic、SQLAlchemy 和 Alembic，负责会话、Agent 执行及外部能力接入。整体职责与执行流程见 [架构说明](../../docs/architecture.md)，完整应用部署见 [运行指南](../README.md)。

以下命令在 `ray_agent/api/` 执行。

## 依赖与配置

需要 Python 3.12+ 和 uv。安装包含测试工具的锁定依赖：

```bash
uv sync --locked --group dev
```

依赖由 [pyproject.toml](pyproject.toml) 声明、[uv.lock](uv.lock) 锁定；[Dockerfile](Dockerfile) 从 [requirements.txt](requirements.txt) 安装。升级时同步核对三者，本地开发不另维护一套手工安装版本。

本地 API 从当前目录 `.env` 加载环境变量，字段定义见 [core/config.py](core/config.py)。模型、密钥与工具配置的职责见[应用配置](../README.md#模型与工具)；宿主机运行时使用本目录的 `config.yaml` 与 `.env`，与产品 Compose 的配置位置区分。

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
| Agent 循环、工具管线与提示词 | `domain/services/flows/`、`domain/services/prompts/` |
| 工具声明与协议适配 | `domain/services/tools/`、`infrastructure/protocols/` |
| 事件模型与 SSE 映射 | `domain/models/event.py`、`interfaces/schemas/event.py` |
| 数据访问与工作单元 | `domain/repositories/`、`infrastructure/repositories/`、`infrastructure/models/` |
| 外部服务与执行资源 | `domain/external/`、`infrastructure/external/` |

## 测试与数据库迁移

```bash
uv run --locked python -m pytest
```

测试配置见 [pytest.ini](pytest.ini)。纯核心与协议用例不会启动应用或连接数据库。只有使用 [conftest.py](tests/conftest.py) 中 `client` fixture 的接口测试会进入应用生命周期、迁移和初始化外部服务，运行它们前需准备独立的测试数据库与 Redis 配置。协议自动测试不能替代真实模型的页面验收。

Agent 循环与工具管线可定向运行：

```bash
uv run --locked python -m pytest tests/core/test_agent_loop.py tests/core/test_llm_usage.py
```

循环用例用 `ScriptedLLM` 驱动实际 `AgentLoop` 与工具三段管线，存储与沙箱用内存替身（夹具在 [tests/support/loop_harness.py](tests/support/loop_harness.py)），覆盖多调用按 ID 配对与计划事件、未知工具与非法参数、工具异常不重试、提问位于批次中间与续接、运行中补充消息、文件交付、输出截断、请求预算、停止或失败后的悬空调用补结果，以及管线短路、结果替换和处理顺序；用量用例核对解析与累计。它们不连接外部服务，也不证明真实模型的任务质量或计费结果。

执行控制可定向运行：

```bash
uv run --locked python -m pytest tests/core/test_task_execution_control.py tests/core/test_agent_task_runner_cancel.py
```

控制用例保留实际应用协调、运行器、任务适配与 Agent 循环，按用例替换模型、传输、存储与沙箱；覆盖等待后用新运行器以回复续接、工具执行中收到的新消息在下一次模型请求前追加而不中断工具、最后一次请求后到达的消息开启下一次运行、重复提交的任务选择、取消请求先于清理完成，以及批次中途停止后经运行器补结果。取消用例用受控阻塞代替长流程，不启动操作系统进程。实际 Shell 进程观察见[沙箱指南](../sandbox/README.md#任务控制观察)；这些用例不能替代真实 Web、Redis、数据库与容器链路验收，也不验证多进程并发排他。

状态与持久化可定向运行：

```bash
uv run --locked python -m pytest tests/core/test_state_persistence.py
```

状态用例核对工具结果先写入记忆再发出 `called` 事件（在 `called` 后停止，续接时保留真实结果）、事件写入失败时不发布通知，以及会话序列化后续接时计划快照与计划 ID 保持。存储、传输、模型与沙箱使用替身；其中写入替身只操作 pytest 临时目录。它们不连接数据库或 Redis，也不模拟 API 进程崩溃和多执行者接管；真实事务回滚见 `test_run_events_pg.py`。

事件与用量可定向运行：

```bash
uv run --locked python -m pytest tests/core/test_event_observability.py tests/core/test_llm_usage.py
```

事件用例核对实时与历史映射一致性、字段投影及毫秒时间、工具耗时字段、返回了响应的模型尝试（含空回复）用量记在轮次完成事件上而传输失败没有，以及一对工具事件只对应一次执行。模型、沙箱与存储均为替身，不验证外部计费或端到端断连。前端解析和时间线归并观察见 [UI 指南](../ui/README.md#事件观察)。

轮次事件与请求重建可定向运行：

```bash
uv run --locked python -m pytest tests/core/test_turn_events_rebuild.py
```

这些用例用内存替身核对轮次成对、终态补写、汇总与重建结果，不连接数据库。序号并发、活动运行唯一、提交失败不发布通知、启动扫描、SSE 补齐和快照往返需要真实临时 PostgreSQL，见 [tests/core/test_run_events_pg.py](tests/core/test_run_events_pg.py)：设置 `RAY_TEST_DATABASE_URI`（`postgresql+asyncpg://…`）后再运行该文件；未设置时 6 项跳过。每个测试会清空 `public` schema 并执行 `alembic upgrade head`，不要指向开发库。

### 脚本化模型替身

[tests/support/scripted_llm.py](tests/support/scripted_llm.py) 的 `ScriptedLLM` 满足模型接口协议：按顺序返回脚本中的文本、工具调用（含 finish_reason 与 usage）或抛出预设异常，支持按本次请求内容的简单分支，记录每次收到的 messages 与 tools 副本，脚本耗尽时抛出 `ScriptExhaustedError`。自测含一次接入 Agent 循环的用例：

```bash
uv run --locked python -m pytest tests/core/test_scripted_llm.py
```

### 端到端评测

[scripts/eval/](scripts/eval/) 通过公开 HTTP API 与 SSE 驱动完整产品，运行 E1–E6 基线任务（定义见 [W0 子计划](../../docs/plan/w0-baseline-eval.md#评测脚本)）与长上下文压缩任务 E7（见 [W2 子计划](../../docs/plan/w2-context.md#验收)）。前提：产品 Compose 已启动且各服务健康，模型已按[应用配置](../README.md#模型与工具)配置。每次运行会调用真实模型并产生费用；E6 会临时写入并在结束时删除一项 MCP 设置；E7 运行期间把模型配置的 `context_window` 与 `max_tokens` 临时调低，结束时恢复，期间同一 API 上的其他会话也使用调低后的值。

```bash
uv run --locked python -m scripts.eval --list
uv run --locked python -m scripts.eval --label w0-baseline
uv run --locked python -m scripts.eval --tasks E2,E4 --repeat 3 --label w1
uv run --locked python -m scripts.eval --label w1 --baseline ../../docs/plan/evidence/w0-baseline-2026-09-28-961005d.json
```

默认经网关 `http://localhost:8088/api` 访问 API，报告写入 `docs/plan/evidence/<label>-<日期>-<提交短哈希>.{json,md}`，同名文件会被覆盖，调试时用 `--output-dir` 写到临时目录。`--baseline` 指定另一份报告 JSON 时，Markdown 增加按任务与运行序号配对的指标对比表；结论文字不自动生成。E5 在宿主机自启静态页面，E6 以子进程运行 [MCP 夹具](tests/protocols/fixture_server.py)，两者都通过 `--host-address`（默认 Docker Desktop 的 `host.docker.internal`）让沙箱与 API 容器访问宿主机；访问不到时记为跳过。E4 停止后应终止本次运行登记的 Shell 会话；沙箱容器本身仍随 TTL 回收。

新任务在 `scripts/eval/tasks.py` 用 `@register("E7")` 注册返回 `TaskSpec` 的函数：声明各轮消息、上传材料、提问回复（`ReplyOnWait`）、定时停止（`StopAfter`）、环境准备与检查函数。离线部分（SSE 解析、指标统计、注册顺序、基线对比表）的测试不连接服务：

```bash
uv run --locked python -m pytest tests/core/test_eval_script.py
```

指标来自 `GET /sessions/{id}` 读回的运行与事件：模型调用次数与 tokens 取运行汇总（终态 `run` 事件的 summary，仍活动的运行取运行行计数），并与 `turn(completed)` 逐轮累加核对；工具调用按 `called` 工具事件计数。评测只验证任务结果，不统计成功率，也不代替页面验收。

### 文件与产物观察

第十二章的确定性测试：

```bash
uv run --locked python -m pytest tests/core/test_file_artifacts.py
```

8 项用例覆盖同路径串行替换、按 ID 删除、上传或关联失败保留旧条目、经 `deliver_files` 的全部与部分交付失败、历史附件保留原 ID，以及已有重复数据不被自动迁移。使用实际运行器交付函数、交付工具和仓库过滤方法，存储与数据库为替身；其中事务回滚用内存快照模拟，不代替数据库验证。

连接可用的 PostgreSQL 后，另运行真实事务与本地存储观察：

```bash
uv run --locked python scripts/check_file_artifacts.py
```

脚本保留生产的 `autoflush=False`，使用真实仓库、UoW 和本地磁盘存储，检查同事务替换、失败回滚、历史附件的旧 ID 与新旧副本字节。数据库操作置于外层回滚事务，各 UoW 使用保存点；只创建专用实验记录，结束后确认已回滚，文件写入临时目录并清理。脚本不调用模型、Redis、产品沙箱或 COS，不覆盖并发、真实数据库提交故障和页面操作。

宿主机不可解析 Compose 内部数据库地址时，在包含当前源码的 API 容器中运行（进入产品目录后执行 `docker compose exec manus-api python scripts/check_file_artifacts.py`）；源码更新方式见 [Docker 说明](../DOCKER.md#重启)。不要把宿主机连接失败表述为用例通过。

### 沙箱环境观察

动态模式下可在本目录运行第十一章的容器观察（需可访问 Docker，且未配置已有沙箱地址）：

```bash
uv run --locked python scripts/check_sandbox_environment.py
```

脚本用实际 `DockerSandbox` 创建两个一次性容器，核对按 ID 重连后读到写入标记、另一容器相同路径不存在、同网络访问状态接口，以及显式销毁后容器不存在。同时核对执行身份为 ubuntu、上传目录与 `/home/ubuntu/.rayagent/outputs` 的属主、服务进程用户、内存/CPU/进程数上限，以及 `SERVER_TIMEOUT_MINUTES` 与超时计时已按 `SANDBOX_TTL_MINUTES` 启动。它不修改已有沙箱、不连接公网、不等到 TTL 到期，也不验证应用关闭清理。本地路径与 Shell 状态观察见[沙箱指南](../sandbox/README.md#执行环境观察)。

数据库结构变化时核对领域模型、ORM 转换与迁移文件：

```bash
uv run --locked alembic revision --autogenerate -m "描述本次结构变化"
uv run --locked alembic upgrade head
```

生成后检查迁移内容再应用。接口或事件变化还需验证客户端解析；任务与协议变化需运行对应真实流程，不能只依赖状态接口测试。

迁移 `5b7e2c9d4a10` 建立 `runs`、`events` 表并删除 `sessions.events`，不把旧 JSONB 事件搬进新表。已有库执行 `alembic upgrade head` 后会话行仍在，事件历史会被丢掉。要清空后重新初始化，只能在明确要删除数据库和文件卷时按 [Docker 操作说明](../DOCKER.md) 使用 `docker compose down -v`，再重新启动。

## 排查入口

启动失败先查看生命周期日志和服务连接；任务创建失败沿任务准备与沙箱适配追踪；事件展示问题同时检查 SSE 映射和前端解析。Compose 启停与按服务查看日志见 [Docker 操作说明](../DOCKER.md)，整体检查入口见 [运行指南](../README.md#排查入口)。

## MCP/A2A

配置位置与生效方式见[应用配置](../README.md#模型与工具)。

pytest 会自己拉起临时协议服务，不依赖本机 9911/9912，也不能代替页面验收：

```bash
uv run --locked python -c 'from importlib.metadata import version; print({p: version(p) for p in ["mcp", "a2a-sdk"]})'
uv export --locked --format requirements-txt --no-dev -o requirements.txt
uv run --locked python -m pytest tests/protocols tests/core
```

### 怎么接到产品里

HTTP MCP 与 A2A 对端必须先运行；stdio MCP 由 API 按配置启动子进程，命令与依赖必须在 API 所在环境可用。双方协议需一致：MCP `2026-07-28`（`stdio` 或 `streamable_http`），A2A 1.0 JSON-RPC。产品只做发现、调用和结果展示；不提供 OAuth、MCP resources、A2A 多轮人工续接。

日常在**首页右上角齿轮**（标题「RayAgent 设置」）添加，不要改仓库 yaml：

1. 打开 http://localhost:8088/ 。会话详情页没有设置按钮。
2. 「MCP 服务器」或「A2A Agent 配置」→ 添加。
3. 开关打开后才会探测。对端没起来会显示「不可用」，配置仍会留下。
4. Docker Desktop 中的 API 访问宿主机用 `host.docker.internal`，不要填容器自己的 `127.0.0.1`。API 跑在宿主机时用 `127.0.0.1`。
5. stdio 的 MCP 必须写 `transport: stdio` 和 `command`；省略 `args`/`env` 分别为 `[]`/`{}`。旧 MCP `sse` 已移除，页面任务事件 SSE 不受影响。
6. 工具失败会作为该调用的失败结果回填模型，由模型决定改参数、换方法或结束，任务不会因此直接终止。
7. 真实凭据只写运行中配置或未跟踪文件，不要提交进仓库。

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
