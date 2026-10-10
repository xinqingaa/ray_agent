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

工具策略与审批可定向运行：

```bash
uv run --locked python -m pytest tests/core/test_tool_approval.py
```

审批用例用 `ScriptedLLM` 驱动实际循环、管线与运行器，覆盖规则匹配与优先级、豁免工具与规则表校验、MCP 别名还原为服务名、deny 短路、ask 挂起进入等待、批准执行一次后补同批剩余调用、重复答复被拒绝、拒绝回填且不执行、挂起瞬间已有排队消息时审批失效并继续、停止时写入失效、启动扫描中断等待审批而保留等待提问、审批事件的 SSE 字段与设置读写。审批与启动扫描在真实数据库上的往返在 `test_run_events_pg.py`，需要临时 PostgreSQL（见下文）。这些用例不连接真实 MCP 或 A2A 服务，也不验证页面上的审批卡。

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

这些用例用内存替身核对轮次成对、终态补写、汇总与重建结果，不连接数据库。序号并发、活动运行唯一、提交失败不发布通知、启动扫描、SSE 补齐和快照往返需要真实临时 PostgreSQL，见 [tests/core/test_run_events_pg.py](tests/core/test_run_events_pg.py)：设置 `RAY_TEST_DATABASE_URI`（`postgresql+asyncpg://…`）后再运行该文件；未设置时数据库用例跳过（数量以当次 pytest 收集结果为准）。每个测试会清空 `public` schema 并执行 `alembic upgrade head`，不要指向开发库。

### 脚本化模型替身

[tests/support/scripted_llm.py](tests/support/scripted_llm.py) 的 `ScriptedLLM` 满足模型接口协议：按顺序返回脚本中的文本、工具调用（含 finish_reason 与 usage）或抛出预设异常，支持按本次请求内容的简单分支，记录每次收到的 messages 与 tools 副本，脚本耗尽时抛出 `ScriptExhaustedError`。自测含一次接入 Agent 循环的用例：

```bash
uv run --locked python -m pytest tests/core/test_scripted_llm.py
```

### 端到端评测

[scripts/eval/](scripts/eval/) 通过公开 HTTP API 与 SSE 驱动完整产品，运行纯回答与记忆、文件交付、提问续接、长命令停止、浏览器取数、MCP 批准/拒绝和长上下文压缩任务。任务定义以脚本为准，历史条件与结果见[基线对比](../../docs/plan/evidence/w8-comparison-2026-09-29.md)。前提：产品 Compose 已启动且各服务健康，模型已按[应用配置](../README.md#模型与工具)配置。每次运行会调用真实模型并产生费用；E6 与 E6-deny 会临时写入并在结束时删除一项 MCP 设置，同时把工具策略表临时设为该服务需要审批，结束时恢复原表；E7 运行期间把模型配置的 `context_window` 与 `max_tokens` 临时调低，结束时恢复，期间同一 API 上的其他会话也使用调低后的值。

```bash
uv run --locked python -m scripts.eval --list
uv run --locked python -m scripts.eval --label local-baseline
uv run --locked python -m scripts.eval --tasks E2,E4 --repeat 3 --label local-repeat
uv run --locked python -m scripts.eval --label local-check --baseline ../../docs/plan/evidence/w0-baseline-2026-09-28-961005d.json
```

默认经网关 `http://localhost:8088/api` 访问 API，报告写入 `docs/plan/evidence/<label>-<日期>-<提交短哈希>.{json,md}`，同名文件会被覆盖，调试时用 `--output-dir` 写到临时目录。`--baseline` 指定另一份报告 JSON 时，Markdown 增加按任务与运行序号配对的指标对比表；结论文字不自动生成。E5 在宿主机自启静态页面，E6 以子进程运行 [MCP 夹具](tests/protocols/fixture_server.py)，两者都通过 `--host-address`（默认 Docker Desktop 的 `host.docker.internal`）让沙箱与 API 容器访问宿主机；访问不到时记为跳过。E4 停止后应终止本次运行登记的 Shell 会话；沙箱容器本身仍随 TTL 回收。

新任务在 `scripts/eval/tasks.py` 用 `@register("E7")` 注册返回 `TaskSpec` 的函数：声明各轮消息、上传材料、提问回复（`ReplyOnWait`）、定时停止（`StopAfter`）、环境准备与检查函数。离线部分（SSE 解析、指标统计、注册顺序、基线对比表）的测试不连接服务：

```bash
uv run --locked python -m pytest tests/core/test_eval_script.py
```

指标来自 `GET /sessions/{id}` 读回的运行与事件：模型调用次数与 tokens 取运行汇总（终态 `run` 事件的 summary，仍活动的运行取运行行计数），并与 `turn(completed)` 逐轮累加核对；工具调用按 `called` 工具事件计数。评测只验证任务结果，不统计成功率，也不代替页面验收。

### 文件预览与打包下载

附件和项目文件共用只读预览服务，不调用模型或准备沙箱。文本有界分段读取；表格与图片在最多三个并发子进程中解析，处理完成或超时后回收进程及临时副本。项目继续采用无符号链接跟随的文件 IO，并校验读取版本；内联内容只开放图片与 PDF，支持 HTTP Range。附件打包使用临时 ZIP，下载分块发送，结束后关闭文件。具体上限集中在[能力与边界](../../docs/capabilities.md#文件预览与下载边界)。

运行依赖 openpyxl、xlrd、defusedxml 与 Pillow 来自锁文件和容器安装清单；xlwt 只用于开发测试生成旧版 XLS，不进入运行镜像。定向检查：

```bash
uv run --locked python -m pytest tests/core/test_file_preview.py tests/core/test_project_download.py tests/core/test_project_files.py tests/core/test_file_artifacts.py
```

预览用例使用真实临时文件、现有销售产物和实际解析子进程，核对工作表、样式、合并格、公式缓存缺失、CSV 引号与分页、大于 5 MiB 的文本/工作簿、取消后的句柄寿命、损坏文件、版本冲突、符号链接、Range 和 ZIP 重名。HTTP 用例通过本地 FastAPI 替换存储与项目解析入口，不连接业务数据库或模型；真实浏览器验证另行记录。

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

### 托管项目挂载观察

默认 Compose 的 API 从自身容器挂载信息解析命名卷，沙箱仅挂项目文件子路径，不登记用户电脑目录。宿主机开发 API 需显式设置 `PROJECT_LOCAL_BIND` 为文件存储目录；解析失败时项目不可用，独立对话可继续。

产品镜像构建后，在产品目录运行：

```bash
docker compose run --rm --no-deps -T manus-api python scripts/check_managed_project_mount.py
```

该脚本创建一次性托管目录与真实沙箱，检查卷子路径、ubuntu 修改/删除与快照目录不可见，并清理本次资源；不连接数据库或模型，不验证运行终态收尾与恢复。脚本尚未打进镜像时可把该脚本通过 stdin 送给同一命令的 `python -`；不能把旧镜像中的文件缺失算通过。

### 项目旧写入者停止观察

产品镜像构建后，在产品目录运行：

```bash
docker compose run --rm --no-deps -T manus-api python scripts/check_project_writer_settling.py
```

脚本仅创建本次唯一项目目录与沙箱，不写业务数据库：启动真实后台写入进程，核对项目/会话/运行标签，保留指定 waiting 容器并停止同项目其他容器，随后停止全部测试容器，检查文件不再增长及改写后的字节不被旧进程覆盖，最后清理本次资源。它不调用模型，也不代替完整运行、上传或恢复验收。持久占用、并发准入、取消、迟到启动、启动核对与事务回滚见 `tests/core/test_project_operations_pg.py`，同样需独立 `RAY_TEST_DATABASE_URI`，其 Docker 为替身。

### 项目上传、快照与下载观察

```bash
RAY_TEST_DATABASE_URI=postgresql+asyncpg://… uv run --locked python -m pytest tests/core/test_project_uploads.py tests/core/test_project_snapshots_pg.py tests/core/test_project_snapshot_disk.py tests/core/test_project_download.py tests/core/test_project_attachments_pg.py
uv run --locked python scripts/check_project_file_lifecycle.py --url http://127.0.0.1:8088/api --output /tmp/project-file-check.json
```

数据库测试使用独立临时 PostgreSQL（每例重建 `public`），文件使用临时目录，Docker 为替身；覆盖上传批次所有权、规则与实际字节复核、保护快照、故障修复、取消、到期与重启。磁盘测试核对内容对象、无硬链接去重、原地恢复、链接与流式 ZIP。真实部署脚本通过 HTTP 新建唯一测试项目，验证覆盖保护、恢复路径/字节、下载、归档快照清理；不调用模型，不替代浏览器验收。项目输入附件上传使用 `/files` 的 `project_id`、当前 `rule_version` 和可选项明确确认参数；已上传 id 在 chat 受理事务中登记 pending，后台停止旧写入者后发布并纳入运行前快照。附件用例验证原子受理、改名、快照锁、结果未知读回、明确 ready 拒绝、启动孤儿收敛；完整链路的历史覆盖见[项目验收](../../docs/plan/evidence/w9-w11-acceptance-2026-10-02.md)，不由这些用例单独证明。脚本保留测试项目并输出其 id 与限定清理范围；检查记录后仅按该范围清理，不能清空业务库或删除其他项目。

### 项目交付副本观察

```bash
RAY_TEST_DATABASE_URI=postgresql+asyncpg://… uv run --locked python -m pytest tests/core/test_project_delivery_pg.py tests/core/test_delivery_projection.py tests/core/test_file_artifacts.py
```

真实 PG 与临时磁盘覆盖按 run/call/path 复用、同名改名、部分失败保留下载、无沙箱补存、复制线程取消与收尾占用；沙箱和模型是替身。工作区归属使用沙箱检查返回的实际解析路径，需要 API 与沙箱镜像同时更新。

真实 Docker 观察脚本在 API 容器内运行，需要先通过 API 新建本次唯一空项目和项目会话，传入其 id（脚本直接受理并准备环境，不调用模型）：

```bash
docker exec manus-api python scripts/check_project_delivery.py --project-id <本次项目id> --session-id <本次会话id> --output /tmp/project-delivery.json
```

脚本创建本次带项目/run 标签的动态沙箱，核对实际路径、交付副本、重复调用、部分失败和销毁后补存，最终销毁该沙箱；输出包含 run、文件与项目关联，项目/会话/附件仍保留。检查结果后记录限定 id、文件存储 key 与项目目录范围，再清理本次资源；不清空业务库或删除其他项目。

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

日常在**侧栏底部「设置」**（标题「RayAgent 设置」）添加，不要改仓库 yaml：

1. 打开 http://localhost:8088/ ，从侧栏底部进入设置；收起侧栏时仍可通过设置入口进入。
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

`start` 会打印设置里应粘贴的地址。添加后两项应为「已连接」，MCP 能看到 `add`。新建独立对话验证调用，不要发在旧对话里。做完：设置里删除临时项，再 `stop`。不要把 `9911`/`9912` 写进仓库 yaml。

每个服务可设 `connect_timeout`、`discovery_timeout`、`call_timeout`（秒），A2A 另有 `cancel_timeout`；配置根节点有 `discovery_budget`。静态认证用 `headers`，stdio 环境用 `env`。

## 模型配置与预算

默认应用窗口为 200000 tokens。已知模型的独立配置覆盖全局默认；实际窗口取应用配置与模型目录上限的较小值，输入上限再扣除生成预留与安全余量。思考模式的生成预算包含推理与回答。设置接口按模型合并更新，校验官方上限、温度与正数输入余量；预算预览由服务端共用规则计算。

新对话首次运行冻结采样参数。已有对话换模型时采用目标模型当前配置，A→B→A 也读取当前 A 配置；活动运行及 waiting 续接保留运行快照。下一新运行重新估算完整有效消息与工具定义，不用其他模型历史 usage 校准；历史 usage 保持累计统计。厂商目录定义思考档位、顺序、关闭方式、历史回传与温度兼容性，前端不固定等级。合法思考响应没有推理片段时记录空字段，区别于丢失推理历史。

配置文件通过版本标记只迁移一次旧默认 131072→200000，自定义预算与既有会话冻结参数不迁移。模型配置检查包含在 `tests/core/test_model_configuration.py`，沿用本指南 pytest 入口。

### 浏览器与网页读取的定向检查

```bash
uv run --locked python -m pytest tests/core/test_browser_efficiency.py tests/core/test_tool_approval.py tests/core/test_event_observability.py
# 受控浏览器：安装与 Playwright 匹配的 Chromium 后显式启用
RAY_TEST_BROWSER=1 uv run --locked python -m pytest tests/core/test_browser_efficiency.py
```

`RAY_TEST_CHROMIUM` 可指定已有测试 Chromium 的可执行文件路径；未设置则使用 Playwright 配套浏览器。场景只操作新建的无头测试浏览器，覆盖正文去重/长尾、表单覆盖与读回、失效引用、标签页、日志、截图边界和观察失败，不访问用户业务网页。完整沙箱 CDP 与存储仍需本地 Compose 任务观察。

### 视觉输入与按需资源检查

```bash
uv run --locked python -m pytest tests/core/test_visual_resources.py tests/protocols/test_protocols.py
```

覆盖按需资源单次准备、停止与迟到所有权、最多三项独立读取、图像字节请求/历史与容量边界、引用重建、本地临时图回收，以及真实 MCP 夹具的所选发现和新运行器恢复。浏览器身份、焦点、隐藏根与 CDP 重连用例需设置前文 `RAY_TEST_BROWSER=1`；新增 PG 图像归属与过期查询在 `test_run_events_pg.py`，仍只能指向独立测试库。

截图 `analyze=true` 请求当前模型观察，`deliver=false` 保存临时图；默认 `deliver=true` 继续交付附件。非视觉模型明确返回不支持视觉，截图仍可留证。临时图捕获满 24 小时且运行结束后由启动/30 秒维护任务回收；永久附件和历史自动截图不回收。新增数据库字段由正常启动迁移，无需清库。Pillow 是 API 的图像尺寸/编码依赖，锁文件和容器安装清单同步。

### 数据删除与清空检查

`/api/data/preview` 读取确认范围，`/api/data/tasks/latest` 及任务 ID 接口读回进度；项目删除与全局清空的受理、重试都经 `/api/data`。该功能使用追加迁移保存清理清单，不要求清空数据库。配置文件不在删除范围内。

```bash
uv run --locked python -m pytest tests/core/test_data_cleanup_resources.py tests/core/test_data_cleanup_routes.py
# 只能使用独立临时测试库，测试会重建 public schema
RAY_TEST_DATABASE_URI=postgresql+asyncpg://USER:PASSWORD@HOST:PORT/TEST_DB uv run --locked python -m pytest tests/core/test_data_cleanup_pg.py
```

PG 检查覆盖真实数据库与本地附件/项目目录删除、共享引用保护、失败重试、占用及并发准入；沙箱销毁和 Redis 使用替身，不能外推真实 COS 或多实例端到端。失败任务不会自动继续删除，需在数据管理中读回并重试；全局清空仅扫描符合本地存储命名约定的残留对象，不扫描 COS 未登记对象。
