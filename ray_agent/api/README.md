# RayAgent API 开发指南

API 即本机核心，使用 FastAPI、Pydantic、SQLAlchemy（aiosqlite）和 Alembic，负责会话、Agent 执行、本机业务库及外部能力接入。整体职责与执行流程见 [架构说明](../../docs/architecture.md)。核心不连接 PostgreSQL、Redis 或对象存储，原 Compose 部署方式不再受支持，见[运行指南](../README.md)。

以下命令在 `ray_agent/api/` 执行。

## 依赖与配置

需要 Python 3.12+ 和 uv。安装包含测试工具的锁定依赖：

```bash
uv sync --locked --group dev
```

依赖由 [pyproject.toml](pyproject.toml) 声明、[uv.lock](uv.lock) 锁定；[requirements.txt](requirements.txt) 由锁文件导出（`uv export --locked --format requirements-txt --no-dev -o requirements.txt`），供保留的容器构建文件使用。升级时同步核对三者与[冻结清单](rayagent-core.spec)，本地开发不另维护一套手工安装版本。

核心只从进程环境读取系统配置，不查找当前目录的 `.env`；字段定义见 [core/config.py](core/config.py)，启动参数可以按顺序叠加环境文件。应用配置（模型、Agent、工具策略、MCP、A2A）保存在业务库，首次启动写入代码默认值，之后经设置接口修改。模型端点的环境变量名称由应用配置的 `llm_endpoints` 声明（默认读取 `DEEPSEEK_URL`、`DEEPSEEK_API_KEY` 等），密钥只从环境读取，不写入业务库，也不返回给页面。

运行核心不需要 PostgreSQL、Redis、Docker 或对象存储。本机执行端口接入前，能力声明把文件访问、本机命令与浏览器报告为未实现，核心不装配这些工具，独立对话仍可使用对话、检索、公开网页读取与计划。保留的 Docker 沙箱适配不再装配，见下文[Docker 沙箱适配](#docker-沙箱适配)。

## 数据根

可写数据都放在启动参数指定的数据根中，资源（迁移脚本、内置 skill）按代码位置或冻结产物的资源目录定位，两者都不依赖当前工作目录：

```text
<数据根>/
├── core.lock                 实例锁：同一数据根同时只允许一个核心
├── rayagent.db               业务库（WAL 模式，另有 -wal、-shm 文件）
├── objects/<身份前两位>/<身份>  内容对象：附件、交付文件、截图
├── sessions/<root_id>/       会话工作目录：uploads/、outputs/、screenshots/、tmp/
├── skills/                   skill 存储
└── tmp/                      上传暂存
```

会话工作目录随会话创建登记为可访问根（`root_id`），目录在首次写入时创建，删除会话时与内容对象一起交给清理任务回收。各目录的职责与回收规则见[架构说明的数据归属](../../docs/architecture.md#数据归属)，数值上限见[运行参数与限额](../../docs/limits.md#本机存储与后台任务)。

## 启动与接口

开发时直接启动核心：

```bash
uv run --locked python sidecar.py --data-root /tmp/rayagent-dev --env-file ../.env
```

`--port` 默认 8000，传 0 由系统分配；`--env-file` 可重复，按顺序叠加。启动时依次取得实例锁、执行迁移、打开业务库、写入默认应用配置、初始化 skill、执行启动扫描并恢复后台任务，完成后才接收请求，并在 stdout 写一行握手；Ctrl-C 停止。同一数据根已有核心运行时启动失败；业务库版本高于程序已知版本时拒绝启动，不降级迁移。

接口说明由应用生成：启动后访问 [OpenAPI 文档](http://localhost:8000/docs)，无需另外维护完整路由表。

### 接口契约

请求、响应、错误与事件以 Pydantic 模型为唯一来源，导出的 OpenAPI、JSON Schema 与 TypeScript 类型提交在 [ray_agent/contracts](../contracts/README.md)。改了路由或模型后在契约目录运行 `npm run generate` 并提交生成结果；只核对 JSON 产物是否过期可在本目录运行：

```bash
uv run --locked python scripts/contracts.py --check
```

- 成功响应是 `{"data": …}`，HTTP 状态为 2xx。
- 失败响应一律是 `{"error": {"code", "message", "retryable", "retry_after_ms", "resource_version", "details"}}`，HTTP 状态由 `code` 决定；业务代码抛应用异常，请求参数校验失败为 `validation_failed` 并在 `details.errors` 给出明细。业务库持续忙碌时返回 `unavailable` 与建议的重试间隔。错误与长操作的使用约定见[契约指南](../contracts/README.md#后续工作包怎样使用契约)。
- `GET /api/status` 返回协议与事件版本、构建与实例身份、存储版本（业务库迁移版本）、能力声明和业务库检查；检查异常时仍为 200，`healthy` 为 false。`GET /api/status/build` 只返回构建身份。
- SSE 帧即事件信封：`event` 行为事件类型，`data` 行带 `seq`、`run_id`、毫秒时间 `created_at`、`event_version` 与该类型字段，`id` 行为 `seq`；会话详情的 `events` 返回同一信封。
- 发送消息可带 `request_id`：同一身份同一内容只受理一次，内容不同返回冲突；结果未知时用 `GET /api/sessions/{id}/requests/{request_id}` 读回。会话详情的 `unconsumed_inputs` 列出已受理但未进入模型上下文的输入，`POST /api/sessions/{id}/inputs/{input_id}/resume` 明确重新发起，核心不会自动开始新的执行。
- 后台长操作经 `GET /api/operations/{id}` 查询，`POST /api/operations/{id}/cancel`、`/retry` 取消或重试。

## 冻结桌面核心

桌面宿主随包分发的核心由 [rayagent-core.spec](rayagent-core.spec) 冻结为 PyInstaller onedir，入口是 [sidecar.py](sidecar.py)。PyInstaller 只在 dev 依赖组，不进入 `requirements.txt`。

```bash
uv sync --locked --group dev
uv run --locked pyinstaller --noconfirm --clean rayagent-core.spec
```

产物在 `dist/rayagent-core/`：入口 `rayagent-core` 与 `_internal/` 依赖目录必须整体分发，`build/` 与 `dist/` 不提交。spec 按文件枚举 `app/`、`core/` 的全部模块（`collect_submodules` 会漏掉没有 `__init__.py` 的目录），并把迁移脚本、内置 skill 和构建身份作为数据文件随包；冻结产物里没有配置文件，也不包含数据库或缓存服务的客户端。

不带参数时入口从 stdin 读取一行 JSON 启动参数（契约类型 `CoreLaunch`），其中的 `data_dir` 就是数据根，就绪后在 stdout 写一行握手（`CoreHandshake`）；宿主侧约定见[桌面宿主指南](../desktop/README.md#宿主与核心的约定)。不冻结时也可以按宿主方式运行入口，用管道保持 stdin 打开，关闭管道即正常停止：

```bash
(echo "{\"data_dir\": \"/tmp/rayagent-core-data\", \"env_files\": [\"$PWD/../.env\"]}"; cat) | uv run --locked python sidecar.py
```

冻结后 `sys.executable` 指向入口本身。预览解析等以 `sys.executable -m 模块` 启动的子进程由入口按 `WORKER_MODULES` 放行，新增这类子进程时同时登记。

## 代码导航

以下路径相对于本目录的 `app/`：

| 问题 | 入口 |
|---|---|
| 应用生命周期与依赖组装 | `main.py`、`interfaces/service_dependencies.py` |
| 会话请求、受理与任务准备 | `interfaces/endpoints/session_routes.py`、`application/services/agent_service.py` |
| Agent 循环、工具管线与提示词 | `domain/services/flows/`、`domain/services/prompts/` |
| 工具声明与协议适配 | `domain/services/tools/`、`infrastructure/protocols/` |
| 事件模型与 SSE 映射 | `domain/models/event.py`、`interfaces/schemas/event.py` |
| 业务库、迁移与工作单元 | `infrastructure/storage/sqlite.py`、`../alembic/`、`domain/repositories/`、`infrastructure/repositories/`、`infrastructure/models/` |
| 后台任务与清理 | `application/services/background_jobs.py`、`application/services/data_service.py` |
| 数据根、会话工作目录与内容对象 | `../core/paths.py`、`infrastructure/external/workdir/`、`infrastructure/external/file_storage/` |
| 外部服务与执行资源 | `domain/external/`、`infrastructure/external/` |

## 测试与数据库迁移

```bash
uv run --locked python -m pytest
```

测试配置见 [pytest.ini](pytest.ini)。全量测试不需要 PostgreSQL、Redis 或 Docker：使用业务库的用例在 pytest 临时目录建立独立数据根并执行迁移（夹具在 [tests/support/sqlite_db.py](tests/support/sqlite_db.py)）；[conftest.py](tests/conftest.py) 的 `client` fixture 把数据根指向临时目录后进入真实应用生命周期。协议自动测试不能替代真实模型的页面验收。

[tests/core/test_contracts.py](tests/core/test_contracts.py) 随全量测试运行，先核对 `ray_agent/contracts/generated` 中的 JSON 产物是否与 Pydantic 定义一致（过期即失败），再检查身份与相对路径校验、所有失败的结构化错误形状、事件联合是否覆盖每种领域事件、能力上报、长操作状态与握手解析。

### 本机存储

```bash
uv run --locked python -m pytest tests/core/test_sqlite_storage.py tests/core/test_sqlite_round_trips.py tests/core/test_skills_sqlite.py
```

存储用例使用真实 SQLite 业务库与实际仓库、运行账本、受理和后台任务代码，覆盖并发写入串行与序号连续、同一任务内嵌套写事务立即失败、活动运行唯一与会话序号唯一、提交失败不可见也不发布通知、提交后通知失败由订阅者按序号补读、SSE 补齐与通知丢失、同一请求身份的并发受理与内容冲突、输入受理后与消费前崩溃（输入保持可见并可重新发起）、消费后崩溃不再重复提供、提问跨重启沿原运行续接、审批跨重启失效、启动扫描、业务库忙碌时只在开始写事务前有界重试、后台任务的旧代次回调被拒绝与重启恢复、取消与重试、会话删除和业务清空的回收、实例锁及过新的 schema。往返用例核对请求重建、压缩、计划模式、图像归属与计划承接并发在 JSON 列中的保存。它们不覆盖多进程同时写同一个数据库文件（实例锁拒绝第二个核心）和磁盘故障。

### Agent 循环与工具管线

```bash
uv run --locked python -m pytest tests/core/test_agent_loop.py tests/core/test_llm_usage.py tests/core/test_run_budget.py tests/core/test_plan_progress.py
```

循环用例用 `ScriptedLLM` 驱动实际 `AgentLoop` 与工具三段管线，存储与执行资源用内存替身（夹具在 [tests/support/loop_harness.py](tests/support/loop_harness.py)），覆盖多调用按 ID 配对与计划事件、未知工具与非法参数、工具异常不重试、提问位于批次中间与续接、运行中补充消息、文件交付、输出截断、请求预算、停止或失败后的悬空调用补结果，以及管线短路、结果替换和处理顺序；用量用例核对解析与累计。预算用例覆盖提醒与收尾的阈值、提示只追加在记忆而系统消息不变、收尾阶段拒绝非白名单调用但可交付并完成、补充消息重置计数、审批续接沿用计数并补发缺失的收尾提示。计划用例检查稳定阶段/步骤身份、范围来源、同批更新与业务动作、承接或范围核对的单次纠正及调用配对、等待续接和压缩后的恢复；核验与成果检查覆盖实际版本、显式通过、分项交付及受限收尾；不会自动将步骤标为完成。它们不连接外部服务，也不证明真实模型的任务质量或计费结果。

### 执行控制

```bash
uv run --locked python -m pytest tests/core/test_task_execution_control.py tests/core/test_agent_task_runner_cancel.py
```

控制用例保留实际应用协调、运行器、任务适配与 Agent 循环，按用例替换模型、传输与存储；覆盖等待后用新运行器以回复续接、工具执行中收到的新消息在下一次模型请求前追加而不中断工具、最后一次请求后到达的消息开启下一次运行、重复提交的任务选择、取消请求先于清理完成，以及批次中途停止后经运行器补结果。取消用例用受控阻塞代替长流程，不启动操作系统进程。这些用例不能替代真实页面与本机执行链路验收。

### 工具策略与审批

```bash
uv run --locked python -m pytest tests/core/test_tool_approval.py
```

审批用例用 `ScriptedLLM` 驱动实际循环、管线与运行器，覆盖规则匹配与优先级、豁免工具与规则表校验、MCP 别名还原为服务名、deny 短路、ask 挂起进入等待、批准执行一次后补同批剩余调用、重复答复被拒绝、拒绝回填且不执行、挂起瞬间已有排队消息时审批失效并继续、停止时写入失效、启动扫描中断等待审批而保留等待提问、审批事件的 SSE 字段与设置读写。审批与启动扫描在真实业务库上的往返见上文本机存储用例。这些用例不连接真实 MCP 或 A2A 服务，也不验证页面上的审批卡。

### 状态、事件与请求重建

```bash
uv run --locked python -m pytest tests/core/test_state_persistence.py tests/core/test_event_observability.py tests/core/test_turn_events_rebuild.py
```

状态用例核对工具结果先写入记忆再发出 `called` 事件（在 `called` 后停止，续接时保留真实结果）、事件写入失败时不发布通知，以及会话序列化后续接时计划快照与计划 ID 保持。事件用例核对实时与历史映射一致性、字段投影及毫秒时间、工具耗时字段、返回了响应的模型尝试（含空回复）用量记在轮次完成事件上而传输失败没有，以及一对工具事件只对应一次执行。轮次用例用内存替身核对轮次成对、终态补写、汇总与重建结果。真实事务、序号并发与 SSE 补齐见本机存储用例；前端解析和时间线归并观察见 [UI 指南](../ui/README.md#事件观察)。

### 脚本化模型替身

[tests/support/scripted_llm.py](tests/support/scripted_llm.py) 的 `ScriptedLLM` 满足模型接口协议：按顺序返回脚本中的文本、工具调用（含 finish_reason 与 usage）或抛出预设异常，支持按本次请求内容的简单分支，记录每次收到的 messages 与 tools 副本，脚本耗尽时抛出 `ScriptExhaustedError`。自测含一次接入 Agent 循环的用例：

```bash
uv run --locked python -m pytest tests/core/test_scripted_llm.py
```

### 端到端评测

[scripts/eval/](scripts/eval) 通过公开 HTTP API 与 SSE 驱动完整产品，任务定义与断言以脚本为准。脚本仍按原 Compose 部署编写（默认经网关 `http://localhost:8088/api` 访问，部分检查读取沙箱文件），对本机核心运行前需要改写入口与依赖文件、Shell、浏览器的任务；改写前的运行结果不能作为本机核心的评测结论。离线部分（SSE 解析、指标统计、注册顺序、基线对比表）的测试不连接服务：

```bash
uv run --locked python -m pytest tests/core/test_eval_script.py
```

### 文件预览、交付与下载

附件共用只读预览服务，不调用模型。文本有界分段读取；表格与图片在有界并发子进程中解析，处理完成或超时后回收进程及临时副本。内联内容开放图片、PDF 与 HTML：图片与 PDF 支持 HTTP Range；HTML 带隔离用的 CSP sandbox 整份返回，并插入内存存储替身。附件打包使用临时 ZIP，下载分块发送，结束后关闭文件。具体上限集中在[运行参数与限额](../../docs/limits.md)。

运行依赖 openpyxl、xlrd、defusedxml 与 Pillow 来自锁文件；xlwt 只用于开发测试生成旧版 XLS。定向检查：

```bash
uv run --locked python -m pytest tests/core/test_file_preview.py tests/core/test_file_artifacts.py
```

预览用例使用真实临时文件和实际解析子进程，核对工作表、样式、合并格、公式缓存缺失、CSV 引号与分页、大于 5 MiB 的文本/工作簿、取消后的句柄寿命、损坏文件、Range 和 ZIP 重名。交付用例使用实际运行器交付函数、交付工具和本地内容对象，覆盖只接受会话工作目录内的文件、相同路径与字节复用附件、改版保留旧附件、替换失败保留旧条目、全部与部分交付失败的区分；事务回滚用内存快照模拟，真实提交见本机存储用例。

### 数据删除与清空检查

删除会话（`POST /api/sessions/{id}/delete`）在一个写事务中删除会话、运行、事件、输入与附件记录并登记清理任务，内容对象与会话工作目录由后台任务回收。全局清空经 `/api/data`：`GET /api/data/preview` 读取确认范围，`POST /api/data/reset` 受理，`GET /api/data/tasks/latest` 与 `/api/data/tasks/{id}` 读回进度，失败后 `POST /api/data/tasks/{id}/retry` 按原清单重试。应用配置与 skill 不在清空范围内。

```bash
uv run --locked python -m pytest tests/core/test_sqlite_storage.py -k "delete or reset or background_job"
```

检查使用真实业务库、临时数据根与实际清理任务，覆盖活动运行阻止清空、确认文字、重复受理冲突、回收目录与内容对象、取消与重试。失败的回收不会自动扩大范围，需读回任务后重试。

### 数据库结构变化

结构变化时核对领域模型、ORM 转换与迁移文件。命令行迁移从 `RAYAGENT_DATA_ROOT` 定位业务库，使用独立的临时数据根：

```bash
RAYAGENT_DATA_ROOT=/tmp/rayagent-migrate uv run --locked alembic upgrade head
RAYAGENT_DATA_ROOT=/tmp/rayagent-migrate uv run --locked alembic revision --autogenerate -m "描述本次结构变化"
```

迁移环境固定使用批量模式（SQLite 以复制表完成 ALTER），迁移期间关闭外键检查，结构变更与版本号在同一事务提交。生成后检查迁移内容再应用，并补充本机存储用例。基线 `0001_baseline` 不承接原 PostgreSQL 数据。接口或事件变化需重新生成[契约](../contracts/README.md)并验证客户端解析；任务与协议变化需运行对应真实流程，不能只依赖状态接口测试。

## 排查入口

核心日志写到 stderr。启动失败先看是否数据根已被其他核心占用、业务库版本是否高于程序、迁移是否失败；发送失败沿受理事务与任务启动追踪，运行中断后先读会话详情的未消费输入；事件展示问题同时检查 SSE 映射和前端解析。

## MCP/A2A

配置保存在业务库，通过设置接口维护，生效方式见[应用配置](../README.md#模型与工具)。

pytest 会自己拉起临时协议服务，不依赖本机 9911/9912，也不能代替页面验收：

```bash
uv run --locked python -c 'from importlib.metadata import version; print({p: version(p) for p in ["mcp", "a2a-sdk"]})'
uv run --locked python -m pytest tests/protocols tests/core
```

### 怎么接到产品里

HTTP MCP 与 A2A 对端必须先运行；stdio MCP 由核心按配置启动子进程，命令与依赖必须在核心所在环境可用。双方协议需一致：MCP `2026-07-28`（`stdio` 或 `streamable_http`），A2A 1.0 JSON-RPC。产品只做发现、调用和结果展示；不提供 OAuth、MCP resources、A2A 多轮人工续接。

1. 从界面侧栏底部进入设置，「MCP 服务器」或「A2A Agent 配置」→ 添加。
2. 开关打开后才会探测。对端没起来会显示「不可用」，配置仍会留下。
3. 核心在本机运行，本机对端地址用 `127.0.0.1`。
4. stdio 的 MCP 必须写 `transport: stdio` 和 `command`；省略 `args`/`env` 分别为 `[]`/`{}`。MCP 传输只接受 `stdio` 或 `streamable_http`；页面任务事件 SSE 属于独立接口。
5. 工具失败会作为该调用的失败结果回填模型，由模型决定改参数、换方法或结束，任务不会因此直接终止。
6. 真实凭据只写运行中配置或未跟踪文件，不要提交进仓库。

### 本地页面验收

夹具只提供加法、固定回复和固定失败，不是生产服务。核心运行时：

```bash
./scripts/run-protocol-fixtures.sh start --local
./scripts/run-protocol-fixtures.sh status
./scripts/run-protocol-fixtures.sh stop
```

`start` 会打印设置里应粘贴的地址。添加后两项应为「已连接」，MCP 能看到 `add`。新建独立对话验证调用，不要发在旧对话里。做完：设置里删除临时项，再 `stop`。

每个服务可设 `connect_timeout`、`discovery_timeout`、`call_timeout`（秒），A2A 另有 `cancel_timeout`；配置根节点有 `discovery_budget`。未写时的默认见[运行参数与限额](../../docs/limits.md)。静态认证用 `headers`，stdio 环境用 `env`。

## 模型配置与预算

逐模型参数在应用设置中维护，端点地址与密钥由环境提供。选择、参数冻结与容量口径见 [Harness 模型请求分工](../../docs/harness.md#模型选择与请求分工)，默认值见[运行参数](../../docs/limits.md#模型与上下文)。模型配置检查包含在 `tests/core/test_model_configuration.py` 与 `tests/core/test_llm_api_key.py`，沿用本指南 pytest 入口。

### 网页读取与浏览器适配的定向检查

```bash
uv run --locked python -m pytest tests/core/test_web_fetch.py tests/core/test_browser_efficiency.py tests/core/test_event_observability.py
# 受控浏览器：安装与 Playwright 匹配的 Chromium 后显式启用
RAY_TEST_BROWSER=1 uv run --locked python -m pytest tests/core/test_browser_efficiency.py
```

网页读取用例用 HTTP 传输替身核对非公开目标与 URL 凭据被拒绝、重定向逐跳复核且固定解析出的公开地址、请求不带 Cookie、传输与解压大小及类型有界，以及正文提取和失败时提示改用浏览器；不访问真实公网。浏览器工具在本机执行端口接入前不进入工具集，浏览器用例检查保留的适配：`RAY_TEST_CHROMIUM` 可指定已有测试 Chromium 的可执行文件路径，未设置则使用 Playwright 配套浏览器；场景只操作新建的无头测试浏览器，覆盖正文去重/长尾、表单覆盖与读回、失效引用、标签页、日志、截图边界和观察失败，不访问用户业务网页。

### 视觉输入与按需资源检查

```bash
uv run --locked python -m pytest tests/core/test_visual_resources.py tests/protocols/test_protocols.py
uv run --locked python -m pytest tests/core/test_attachment_images.py
```

覆盖按需资源单次准备、停止与迟到所有权、有界独立读取、图像字节请求/历史与容量边界、引用重建、本地临时图回收，以及真实 MCP 夹具的所选发现和新运行器恢复。浏览器身份、焦点、隐藏根与 CDP 重连用例需设置前文 `RAY_TEST_BROWSER=1`；图像归属与过期查询在业务库上的往返见 `test_sqlite_round_trips.py`。

截图的分析、交付与临时资源回收见 [Harness 视觉资源](../../docs/harness.md#浏览器动作与视觉资源)，用户图片行为见[产品说明](../../docs/product.md#发起任务与输入材料)。API 图片参数支持 `image_mode=auto` 与 `files`，分别按模型能力组织输入或只提供文件材料；`image_input_note` 记录未提供像素的原因并进入模型上下文。

图片检查使用真实 PNG/GIF/EXIF 编码与实际适配层，存储、数据库、模型为替身，覆盖引用校验、请求重建、等待与注入、冻结能力、容量原因、附件放入会话工作目录时的同名处理及规则传递。这些检查不证明真实模型的识图质量或规则遵循。

## 构建身份、计划承接与真实视口

`POST /sessions/{id}/chat` 可附 `execute_plan`：`source_run_id`、`plan_id`、`source_seq`、`request_id`。仅用于普通模式确认清单；事务内校验最新可执行版本，无活动运行时原子创建运行和承接事件。相同请求返回原 run_id/seq，过期、跨会话或冲突请求返回 409；普通消息不做关键词确认。计划事件包含 `progress_state`、`review_only` 和可选 `accepted_from`；缺失状态字段时按 confirmed 兼容解读。轻量核对不增加清单版本。

计划层级、范围来源、更新约束与核验收尾统一见 [Harness 计划清单](../../docs/harness.md#计划清单)及[成果交付](../../docs/harness.md#核验与成果交付)。旧结构的计划记录不自动转换或删除，排查时核对保存的事件与工具 Schema。检查入口：

```bash
uv run --locked python -m pytest tests/core/test_staged_plan.py tests/core/test_plan_progress.py tests/core/test_agent_loop.py
```

冻结构建生成内容身份，`GET /api/status/build` 读回，运行快照保存 `api_build`。身份与提示的关系见[架构说明](../../docs/architecture.md#构建身份与运行快照)。检查入口：

```bash
uv run --locked python -m pytest tests/core/test_build_identity.py tests/core/test_plan_progress.py tests/core/test_run_budget.py tests/core/test_task_execution_control.py
uv run --locked python -m pytest tests/core/test_sqlite_round_trips.py -k plan_acceptance
RAY_TEST_BROWSER=1 uv run --locked python -m pytest tests/core/test_browser_efficiency.py
```

真实浏览器检查支持 `RAY_TEST_CHROMIUM` 指向已有 Chromium。视口检查包含真实媒体查询、其他标签页不变、尺寸校验、所有权冲突、关闭页、CDP 重连、等待与取消收尾；不以改 CSS 替代视口变更。

### Responses 模型通信

端点的 `api_protocol` 支持 `responses` 与 `chat_completions`，缺省为 `responses`。协议编码、完整终态与错误分类见 [Harness 通信边界](../../docs/harness.md#模型通信与失败隔离)，重试及连接池参数见[运行参数](../../docs/limits.md#请求预算压缩与结果)。诊断连接失败时检查日志中的 `cause=` 异常链；只读请求重建返回适配前消息与工具，不能据此判断图像字节已发送。

```bash
uv run --locked python -m pytest tests/core/test_responses_api.py tests/core/test_openai_stream.py tests/core/test_streaming_loop.py tests/core/test_turn_events_rebuild.py
```

Responses 检查使用真实 SDK 与 HTTP 替身，覆盖厂商编码、多轮推理、图片、错误分类、截断与半截调用隔离；实际上游支持需单独运行验证。

### skill 安装与运行检查

```bash
uv run --locked python -m pytest tests/core/test_skills.py tests/core/test_skill_management_http.py tests/core/test_skills_sqlite.py
```

纯核心用例使用临时磁盘、事务仓储和脚本化模型，覆盖包安全、哈希、幂等、故障重试、固定版本、显式与自动加载、模式、审批和压缩；HTTP 用例走真实路由，覆盖安装前读取、正文修订、无正文 DELETE 与空正文契约。业务库用例在临时数据根上验证并发更新、受理事务冻结及外键引用释放，不调用真实模型。

skill 存储在数据根的 `skills/` 目录，各项预算见[参数页](../../docs/limits.md#skill)。私有仓库和 CLI 安装不受理，错误需通过操作身份查询；真实 GitHub 与模型条件分别验证，不能由替身测试推断。资源材料准备依赖执行环境，本机执行端口接入前不提供。

真实效果检查需在相同模型和工具条件下，比较无 skill、显式选择和自动加载，并预先给出独立成果预期。任务分别覆盖正文方法、参考资料、脚本或素材使用及无关任务，核对是否选中相关方法、读取必要资源并实际遵循；同时区分成果质量、人工纠正、耗时与用量。内置 `find-skills` 另检查发现相关性、兼容性和不必要搜索，不能由加载成功或 `completed` 推断质量提升。公开 GitHub 来源需固定提交并核对清单；网络或模型不可用时明确范围，不用本地替身冒充真实来源或效果对照。

## Docker 沙箱适配

`infrastructure/external/sandbox/docker_sandbox.py` 与 docker SDK 依赖保留到本机执行端口接入，核心启动不初始化 Docker，也不把它装配进运行。需要单独观察适配本身时（需可访问 Docker），可运行：

```bash
uv run --locked python scripts/check_sandbox_environment.py
```

脚本用实际 `DockerSandbox` 创建两个一次性容器，核对按 ID 重连、容器之间隔离、资源上限与 TTL 设置，并显式销毁；它不代表核心当前的运行能力。沙箱侧的实现与检查见[沙箱指南](../sandbox/README.md)。
