# RayAgent API 开发指南

API 即本机核心，使用 FastAPI、Pydantic、SQLAlchemy（aiosqlite）和 Alembic，负责会话、Agent 执行、本机业务库及外部能力接入。整体职责与执行流程见 [架构说明](../../docs/architecture.md)。核心不连接 PostgreSQL、Redis 或对象存储，由[桌面宿主](../desktop/README.md)拉起；模型连接与运行检查见[运行指南](../README.md)。

以下命令在 `ray_agent/api/` 执行。

## 依赖与配置

需要 Python 3.12+ 和 uv。安装包含测试工具的锁定依赖：

```bash
uv sync --locked --group dev
```

依赖由 [pyproject.toml](pyproject.toml) 声明、[uv.lock](uv.lock) 锁定。升级时同步核对两者与[冻结清单](rayagent-core.spec)，并重新冻结核心检查启动，本地开发不另维护一套手工安装版本。

核心只从进程环境读取系统配置，不查找 `.env`；字段定义见 [core/config.py](core/config.py)。应用配置（逐模型参数、Agent、工具策略、MCP、A2A）保存在业务库，首次启动写入代码默认值，之后经设置接口修改。模型地址与密钥只从用户配置文件读取（默认 `~/.config/rayagent/config.toml`，`RAYAGENT_CONFIG` 可另指，格式见[配置示例](config.example.toml)），按文件身份重新读取；密钥不写入业务库，`GET /api/app-config/llm` 只返回配置文件状态、各提供商的地址、协议、模型与密钥掩码。测试不读用户目录，夹具把配置文件指向临时目录。

运行核心不需要 PostgreSQL、Redis、Docker 或对象存储。文件访问经限根端口完成；Shell 按执行开关启用，浏览器在组件可用时提供。两者按需分配执行资源，旧 Docker 沙箱适配已移除。

## 数据根

可写数据都放在启动参数指定的数据根中，资源（迁移脚本、内置 skill）按代码位置或冻结产物的资源目录定位，两者都不依赖当前工作目录：

```text
<数据根>/
├── core.lock                 实例锁：同一数据根同时只允许一个核心
├── install_id                本机安装身份：首次启动生成，工作区文件夹的身份标记按它区分本机条目
├── rayagent.db               业务库（WAL 模式，另有 -wal、-shm 文件）
├── objects/<身份前两位>/<身份>  内容对象：附件、交付文件、截图
├── sessions/<root_id>/       会话工作目录：uploads/、outputs/、screenshots/、tmp/
├── skills/                   skill 存储
└── tmp/                      上传暂存
```

开发模式（不经宿主）还会写入仅本人可读的 `dev_host_secret`，内容是本次启动的宿主密钥，调试宿主专用接口时从这里取。

会话工作目录随会话创建登记为可访问根（`root_id`），目录在首次写入时创建，删除会话时与内容对象一起交给清理任务回收。各目录的职责与回收规则见[架构说明的数据归属](../../docs/architecture.md#数据归属)，数值上限见[运行参数与限额](../../docs/limits.md#本机存储与后台任务)。

## 启动与接口

开发时直接启动核心：

```bash
uv run --locked python sidecar.py --data-root /tmp/rayagent-dev
```

`--port` 默认 8000，传 0 由系统分配。开发模式没有宿主，启动时随机生成宿主密钥并写入数据根的 `dev_host_secret`。启动时依次取得实例锁、执行迁移、打开业务库、写入默认应用配置、初始化 skill、执行启动扫描并恢复后台任务，完成后才接收请求，并在 stdout 写一行握手；Ctrl-C 停止。同一数据根已有核心运行时启动失败；业务库版本高于程序已知版本时拒绝启动，不降级迁移。

每次启动生成新的实例令牌并写在握手的 `instance_token` 中，`/api/` 下的请求都要带 `Authorization: Bearer <令牌>`，CORS 预检除外；令牌不进 URL 与日志。图片、PDF 与网页预览由 WebView 按 URL 直接加载，无法带请求头：先用 `POST /api/files/{id}/preview/ticket` 申请短期票据，再把 `ticket` 参数加到 `/api/files/{id}/preview/content`。票据只放行签发时那条路径的 GET 与 HEAD，到期作废，只存在进程内存；有效期与容量见[运行参数与限额](../../docs/limits.md#桌面宿主与核心进程)。

### 工作区与文件夹授权

工作区文件夹的来源只有两个：在默认位置（`GET/POST /api/workspaces/default-location`）下新建，或打开宿主选择器选中的已有文件夹。核心不接受界面提交的桌面绝对路径：宿主在启动参数里把宿主密钥交给核心（不进环境变量），选择文件夹后带 `X-RayAgent-Host-Secret` 头调用 `POST /api/host/folder-grants` 登记路径，得到一次性、短期有效的 `grant_id`；界面用它调用 `POST /api/workspaces/open` 或更改默认位置，凭证用过即作废。实例令牌不能代替宿主密钥。打开已有文件夹返回扫描摘要；标记指向本机已知工作区且原文件夹仍在（复制）时返回 `status=conflict` 与 `conflict`，用 `POST /api/workspaces/open/resolve` 选择 `as_new` 或 `rebind`。文件按 `root_id` 加相对路径访问（`/api/roots/{root_id}/…`），会话创建时可带 `workspace_id`，会话列表（`GET /api/sessions`）与列表流（`POST /api/sessions/stream`）可按 `workspace_id` 过滤，或用 `independent=true` 只取没有工作区的独立对话（两者同用返回 400，过滤发生在分页之前）。会话详情（`GET /api/sessions/{id}`）同样返回 `workspace_id`（独立对话为空），界面用它把地址归到工作区页或独立对话页。

重新定位：`POST /api/workspaces/{id}/relocate`，body `{grant_id, version}`，把工作区改绑到宿主选中的另一个文件夹，不依赖身份标记，标记不可写时仍可用。校验同打开（嵌套、数据根与系统目录返回 400，`details.reason` 同打开）；目标已绑定其他工作区（`details.reason=already_bound`）、目标标记属于本机另一个工作区（`marker_other_workspace`，带 `workspace_id` 与 `workspace_name`）、`version` 过期（带 `resource_version`）、有未释放的写入租约（`details.lease`）或活动运行（`details.session_id`、`details.run_id`）时返回 409，`grant_id` 无效返回 410。成功返回工作区详情：根与 `root_id` 不变，位置、文件系统身份与可用性更新，目标内尽力写入标记并移除旧位置的本机条目；外部变更订阅自动切到新位置并推送一次整体刷新。

显示位置：宿主带 `X-RayAgent-Host-Secret` 调用 `POST /api/host/roots/{root_id}/resolve`，body `{relative_path}`（空表示根本身），返回 `{path}`，只供宿主在系统文件管理器里定位。适用于会话工作目录与工作区文件夹两类根，按根身份与路径规则核对：不越出根，`.rayagent`、版本控制内部与凭据、数据库文件返回 403，目标不存在返回 404，根不存在返回 404，路径非法返回 400，只放行普通文件与目录；交付文件的 `root_id` 与 `relative_path` 即可直接传入。绝对路径不进入界面。

### 工作区写入保护、撤销与外部变更

工作区详情与列表的 `write_lease` 给出文件夹当前的写入者（为空表示没有）；也可单独读 `GET /api/workspaces/{id}/write-lease`。其他会话写入被占用时，文件工具得到可读的失败，接口得到 409 且 `details.lease` 带持有者、阶段与原因。`state` 为 `settling` 或 `blocked`（停止后未能确认写入结束）时，`POST /api/workspaces/{id}/write-lease/retry-settle` 重试收尾，确认后释放，仍未确认返回 409。未知进程保持 blocked；用户确认旧进程已结束后，可调用 `POST …/write-lease/confirm-release` 并带读回的 `lease_id`，只释放所见的 blocked 进程租约；身份已变化或所属运行仍活跃时拒绝。

撤销：`GET /api/workspaces/{id}/modified-runs` 列出最近修改过文件夹的运行与撤销操作（项里的 `kind` 为 `run` / `undo`，撤销操作的 `run_id` 是它自己的操作身份，`undo_of_run_id` 指向被撤销的运行，其变更同样可查看与撤回）；`GET …/runs/{run_id}/changes` 给出每个文件的净操作、运行前版本、运行最后写入版本、当前版本与 `status`（`undoable` / `restored` / `conflict`；冲突原因 `conflict_reason` 含 `modified_during_run`：运行期间文件被外部修改过，可强制恢复）；`GET …/runs/{run_id}/changes/preview?path=` 返回当前版本到撤销后版本的统一 diff（二进制或过大只给大小；`warning` 非空时说明撤销会丢掉运行期间的外部修改）；`POST …/runs/{run_id}/undo` 带 `items[{relative_path, force?}]`，逐个返回 `restored` / `removed` / `unchanged` / `conflict` / `failed`。冲突项带当前版本与 `can_force`，把当前版本原样放进 `force` 再提交才会覆盖；运行新建的文件被改动后不提供覆盖。租约被占用、运行仍在进行时整体返回 409。

外部变更：`GET /api/workspaces/{id}/changes/stream` 是 SSE，先发 `ready`（当前是否可用），之后发 `changed`（`paths` 或 `refresh`）与 `availability`；事件数据结构见契约里的 `WorkspaceChangeEvent`，应用自己的写入也会触发 `changed`。

接口说明由应用生成：启动后访问 `/docs` 查看 OpenAPI 文档（文档页本身不需要令牌，从页面调用接口需要），无需另外维护完整路由表。

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

桌面宿主随包分发的核心由 [rayagent-core.spec](rayagent-core.spec) 冻结为 PyInstaller onedir，入口是 [sidecar.py](sidecar.py)。PyInstaller 只在 dev 依赖组。

```bash
uv sync --locked --group dev
uv run --locked python scripts/prepare_tool_runtimes.py
uv run --locked pyinstaller --noconfirm --clean rayagent-core.spec
```

产物在 `dist/rayagent-core/`：入口 `rayagent-core` 与 `_internal/` 依赖目录必须整体分发，`build/` 与 `dist/` 不提交。spec 按文件枚举 `app/`、`core/` 的全部模块（`collect_submodules` 会漏掉没有 `__init__.py` 的目录），`collect_all` 纳入 ONNX Runtime、LanceDB、PyArrow、OpenCV、RapidOCR、Playwright、tokenizers 等原生库与数据文件，并把迁移脚本、内置 skill、构建身份、`package_identity.json`、组件清单与第三方许可摘要作为数据文件随包；冻结产物里没有配置文件，也不包含数据库或缓存服务的客户端。完整应用打包见[桌面开发指南](../desktop/README.md#构建内部包apple-silicon)。

业务库迁移由 `migrate()` 在启动时执行：schema 低于本程序 head 时先在数据根 `upgrades/` 用 SQLite 备份接口写升级前副本，再升级；版本超出本程序已知修订时抛出 `SchemaTooNew`，旧二进制不能打开。定向检查：

```bash
uv run --locked python -m pytest tests/core/test_sqlite_storage.py::test_schema_upgrade_writes_pre_upgrade_backup_and_keeps_rows tests/core/test_sqlite_storage.py::test_instance_lock_and_newer_schema_are_refused
```

不带参数时入口从 stdin 读取一行 JSON 启动参数（契约类型 `CoreLaunch`），其中的 `data_dir` 就是数据根，就绪后在 stdout 写一行握手（`CoreHandshake`）；宿主侧约定见[桌面宿主指南](../desktop/README.md#宿主与核心的约定)。不冻结时也可以按宿主方式运行入口，用管道保持 stdin 打开，关闭管道即正常停止：

```bash
(echo '{"data_dir": "/tmp/rayagent-core-data", "host_secret": "0123456789abcdef0123456789abcdef"}'; cat) | uv run --locked python sidecar.py
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
| 工作区、文件夹授权与限根文件访问 | `application/services/workspace_service.py`、`application/services/root_access.py`、`domain/services/file_scope.py`、`infrastructure/external/workspace_files/` |
| 写入租约、写前备份、撤销与外部变更 | `application/services/write_leases.py`、`workspace_writer.py`、`file_history.py`、`workspace_changes.py`、`infrastructure/external/file_storage/workspace_objects.py`、`infrastructure/external/workspace_files/watcher.py` |
| 工作方式、记忆、检索与上下文装配 | `application/services/working_style_service.py`、`memory_service.py`、`retrieval_service.py`、`context_assembly.py`、`memory_jobs.py`、`workspace_memory_runtime.py`；路由 `instruction_routes.py`、`memory_routes.py`、`retrieval_routes.py` |
| 文档登记、解析与全文索引 | `document_index_service.py`、`document_index_scheduler.py`、`infrastructure/external/document_parse/`；路由 `document_routes.py`；`OperationKind.DOCUMENT_INDEX`；迁移 `0006_document_knowledge` |
| 语义索引与 OCR | `semantic_index_service.py`、`embedding/e5_onnx.py`、`vector_store/lancedb_store.py`、`ocr/rapid_ocr.py`；组件 `local_components.py` 与 `resources/component_*.json`；`OperationKind.SEMANTIC_INDEX`；迁移 `0007_semantic_index` |
| 外部服务与执行资源 | `domain/external/`、`infrastructure/external/` |

## 测试与数据库迁移

```bash
uv run --locked python -m pytest
```

测试配置见 [pytest.ini](pytest.ini)。全量测试不需要 PostgreSQL、Redis 或 Docker：使用业务库的用例在 pytest 临时目录建立独立数据根并执行迁移（夹具在 [tests/support/sqlite_db.py](tests/support/sqlite_db.py)）；[conftest.py](tests/conftest.py) 的 `client` fixture 把数据根指向临时目录后进入真实应用生命周期。协议自动测试不能替代真实模型的页面验收。

[tests/core/test_contracts.py](tests/core/test_contracts.py) 随全量测试运行，先核对 `ray_agent/contracts/generated` 中的 JSON 产物是否与 Pydantic 定义一致（过期即失败），再检查身份与相对路径校验、所有失败的结构化错误形状、事件联合是否覆盖每种领域事件、能力上报、长操作状态与握手解析。

### 本机存储

```bash
uv run --locked python -m pytest tests/core/test_sqlite_storage.py tests/core/test_sqlite_round_trips.py tests/core/test_sqlite_cancellation.py tests/core/test_skills_sqlite.py
```

存储用例使用真实 SQLite 业务库与实际仓库、运行账本、受理和后台任务代码，覆盖并发写入串行与序号连续、同一任务内嵌套写事务立即失败、活动运行唯一与会话序号唯一、提交失败不可见也不发布通知、提交后通知失败由订阅者按序号补读、SSE 补齐与通知丢失、同一请求身份的并发受理与内容冲突、输入受理后与消费前崩溃（输入保持可见并可重新发起）、消费后崩溃不再重复提供、提问跨重启沿原运行续接、审批跨重启失效、启动扫描、业务库忙碌时只在开始写事务前有界重试、后台任务的旧代次回调被拒绝与重启恢复、取消与重试、会话删除和业务清空的回收、实例锁、过新的 schema 拒绝，以及 schema 升级前副本与数据保留。往返用例核对请求重建、压缩、计划模式、图像归属与计划承接并发在 JSON 列中的保存。取消用例用慢查询让任务取消、anyio 取消范围与模拟的 SSE 断开落在进行中的数据库调用上，核对连接全部归还、aiosqlite 线程不增长、连接池不报终止或重置错误、被取消的写事务不遗留写锁，以及之后的写入照常进行。它们不覆盖多进程同时写同一个数据库文件（实例锁拒绝第二个核心）和磁盘故障。

新增长连接或流式接口时沿用[业务库的取消约定](../../docs/architecture.md#业务库与写协调)：每次查库用短的工作单元，等待通知、sleep 或 yield 时不持有会话；直接使用 `Database` 时经 `read_session()`／`write_session()` 取得会话，不要手动打开后跨等待持有。

事件流共用响应适配层：服务器停止取消推送后，为仍连接的客户端补齐响应结束；客户端已断连、发送失败或调用被取消时不补发，也不吞掉异常。定向检查运行 `uv run --locked python -m pytest tests/core/test_event_stream_response.py`，覆盖正常完成、服务器停止、客户端断连、生成器异常与外部取消的 ASGI 收尾。

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

[scripts/eval/](scripts/eval) 通过公开 HTTP API 与 SSE 驱动完整产品，任务定义与断言以脚本为准。脚本仍按原部署编写：默认地址是开发模式的 `http://127.0.0.1:8000/api`，但请求不带实例令牌，部分检查读取沙箱文件，依赖文件、Shell 与浏览器的任务在本机执行端口接入前也无法完成；对本机核心运行前需要改写这些入口，改写前的运行结果不能作为本机核心的评测结论。离线部分（SSE 解析、指标统计、注册顺序、基线对比表）的测试不连接服务：

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

### 工作区写保护检查

撤销接口的纳秒文件版本以十进制字符串传输，界面原样回传，接口层再转为整数核对；不接受可能已经失真的数字。工作区写保护用例还通过真实文件与 HTTP 读回版本，检查精确覆盖、陈旧版本拒绝和覆盖前备份。

```bash
uv run --locked python -m pytest tests/core/test_write_protection.py tests/core/test_agent_task_runner_cancel.py
```

用例使用真实临时目录与真实业务库，覆盖两个会话争用同一文件夹的立即冲突与同一运行重入、停止后释放、确认期限内未确认转阻止并重试、迟到结果不释放新租约、启动扫描旧实例租约、覆盖前备份与同内容去重、备份失败不写入、撤销成功与运行新建文件的移除、外部改动后的冲突与显式覆盖、被改动的新建文件不删除、运行进行中拒绝撤销、真实文件系统通知（辅以重扫）与文件夹移走后的不可用、运行期间外部改动的撤销冲突与撤销操作本身的撤回、文件工具对凭据与版本控制内部路径及其 Unicode 等价名的拒绝，以及清空业务数据不删除用户文件。边界用例见 `test_workspace_integrity.py`：失联工作区的嵌套检查、改绑期间的写入、外接卷设备号变化、标记兼容、删除与写入的竞态、租约残留恢复、监视异常恢复；描述符紧张下的遍历与残留临时文件见 `test_workspace_files.py`。它们不覆盖多个核心进程争用同一数据根（实例锁拒绝第二个核心）、主动脱离监管的后台服务和外部非受管写入者和非 POSIX 文件系统的原子替换与通知差异。覆盖发布用 `rename` 替换目标，最后一次核对与替换之间仍有很小的竞争窗口（尚未改用 macOS 的 `renamex_np` 条件替换），测试无法证明窗口被消除。

### 工作方式与记忆检查

覆盖两个工作区与独立对话的隔离、常驻记忆与工作方式进入新运行、D4 提炼规则（用户保护条目转候选、迟到代次拒绝、撤回抑制）、运行结束登记摘要／提炼任务、续接前移除已撤回条目，以及 HTTP 冒烟。提炼与摘要的模型调用在测试中用注入替身，不证明真实模型质量。

### 文档知识检查

`test_document_knowledge.py` 覆盖 TXT／Markdown／CSV 解析、图片标待 OCR 组件、两工作区文件片段检索不串、修改后旧片段撤出 FTS、删除后撤回，以及按 chunk 读回来源。解析在真实子进程 worker 中执行；不覆盖 Embedding／LanceDB 与 OCR 识别（P7）。

```bash
uv run --locked python -m pytest \
  tests/core/test_memory_isolation.py \
  tests/core/test_memory_extraction_rules.py \
  tests/core/test_memory_context_runtime.py \
  tests/app/interfaces/endpoints/test_memory_routes.py
```

### 数据删除与清空检查

删除会话（`POST /api/sessions/{id}/delete`）在一个写事务中删除会话、运行、事件、输入与附件记录并登记清理任务，内容对象与会话工作目录由后台任务回收。全局清空经 `/api/data`：`GET /api/data/preview` 读取确认范围，`POST /api/data/reset` 受理，`GET /api/data/tasks/latest` 与 `/api/data/tasks/{id}` 读回进度，失败后 `POST /api/data/tasks/{id}/retry` 按原清单重试。同一事务还删除全部工作区登记、写前备份与写入租约，不删除任何工作区文件夹或其中的文件，本机标记条目由回收任务尽力移除。应用配置与 skill 不在清空范围内。

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

配置保存在业务库，通过设置接口维护，保存后对新运行生效。

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
./scripts/run-protocol-fixtures.sh start
./scripts/run-protocol-fixtures.sh status
./scripts/run-protocol-fixtures.sh stop
```

`start` 会打印设置里应粘贴的地址。添加后两项应为「已连接」，MCP 能看到 `add`。新建独立对话验证调用，不要发在旧对话里。做完：设置里删除临时项，再 `stop`。

每个服务可设 `connect_timeout`、`discovery_timeout`、`call_timeout`（秒），A2A 另有 `cancel_timeout`；配置根节点有 `discovery_budget`。未写时的默认见[运行参数与限额](../../docs/limits.md)。静态认证用 `headers`，stdio 环境用 `env`。

## 模型配置与预算

逐模型参数在应用设置中维护，端点地址与密钥由用户配置文件提供，见上文[依赖与配置](#依赖与配置)。选择、参数冻结与容量口径见 [Harness 模型请求分工](../../docs/harness.md#模型选择与请求分工)，默认值见[运行参数](../../docs/limits.md#模型与上下文)。模型配置检查包含在 `tests/core/test_model_configuration.py`、`tests/core/test_llm_api_key.py` 与 `tests/core/test_llm_endpoints.py`（配置文件解析、单项错误隔离、掩码与权限提醒），沿用本指南 pytest 入口。

### 网页读取与浏览器适配的定向检查

```bash
uv run --locked python -m pytest tests/core/test_web_fetch.py tests/core/test_browser_efficiency.py tests/core/test_event_observability.py
# 受控浏览器：安装与 Playwright 匹配的 Chromium 后显式启用
RAY_TEST_BROWSER=1 uv run --locked python -m pytest tests/core/test_browser_efficiency.py
```

网页读取用例用 HTTP 传输替身核对非公开目标与 URL 凭据被拒绝、重定向逐跳复核且固定解析出的公开地址、请求不带 Cookie、传输与解压大小及类型有界，以及正文提取和失败时提示改用浏览器；不访问真实公网。浏览器工具在组件可用时进入工具集，浏览器用例检查实际适配：`RAY_TEST_CHROMIUM` 可指定已有测试 Chromium 的可执行文件路径，未设置则使用 Playwright 配套浏览器；场景只操作新建的无头测试浏览器，覆盖正文去重/长尾、表单覆盖与读回、失效引用、标签页、日志、截图边界和观察失败，不访问用户业务网页。

### 视觉输入与按需资源检查

```bash
uv run --locked python -m pytest tests/core/test_attachment_images.py tests/protocols/test_protocols.py
```

附件用例覆盖图像字节请求、历史重建、容量边界、等待与注入的规则，以及同名附件落盘；协议用例覆盖真实 MCP 夹具的所选发现和新运行器恢复。不能据此推断任意视觉资源的取消和回收路径均已覆盖。浏览器身份、焦点、隐藏根与 CDP 重连用例需设置前文 `RAY_TEST_BROWSER=1`；图像归属与过期查询在业务库上的往返见 `test_sqlite_round_trips.py`。

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

skill 存储在数据根的 `skills/` 目录（`versions/` 为内容快照），各项预算见[参数页](../../docs/limits.md#skill)。除应用管理库与内置包外，会发现用户／工作区约定目录与设置中的额外目录；运行绑定快照版本，外部目录更新不影响已冻结运行。私有仓库不受理；本机 CLI 安装不进入管理库，但用户目录中的标准包可被发现。错误需通过操作身份查询；真实 GitHub 与模型条件分别验证，不能由替身测试推断。`prepare_skill_resources` 映射已发布快照根路径，不自动执行包管理器安装。多来源检查见 `tests/core/test_skill_multi_source.py`。

真实效果检查需在相同模型和工具条件下，比较无 skill、显式选择和自动加载，并预先给出独立成果预期。任务分别覆盖正文方法、参考资料、脚本或素材使用及无关任务，核对是否选中相关方法、读取必要资源并实际遵循；同时区分成果质量、人工纠正、耗时与用量。内置 `find-skills` 另检查发现相关性、兼容性和不必要搜索，不能由加载成功或 `completed` 推断质量提升。公开 GitHub 来源需固定提交并核对清单；网络或模型不可用时明确范围，不用本地替身冒充真实来源或效果对照。

## 本机执行

Shell 与脚本经执行 supervisor（Unix 套接字 IPC）启动，进程树由 supervisor 回收；工作区用 `local_execution_enabled`，独立对话用应用配置 `standalone_execution_enabled`。工具 PATH 优先使用随包正常 CPython／Node；冻结包首次执行时校验归档并原子展开到数据根，核对实际版本和独立动态库，其后仅为系统目录，不搜索 Homebrew 或任意数据根运行时目录。开发环境先运行上文运行时准备命令；固定来源、版本、哈希与许可证由随包清单约束，缺失时命令能力不可用。

设置的“运行组件”通过 `/api/components` 读取状态，`POST /api/components/{id}/install` 携带 `request_id` 受理，返回标准长操作；查询、取消、重试复用 `/api/operations`。状态和身份保存在业务库，重启后接管到新代次，已请求的取消不会被清除。组件 worker 由 supervisor 按操作登记，在独立版本目录获取、校验，发布前在写事务里核对代次与取消；完整收据原子替换后才可用。目标版本变化不会提前撤下兼容旧版本；失败、取消和重启保持旧收据，只有完整校验成功才切换，不兼容时提示原因。浏览器用固定官方压缩包哈希，Embedding／OCR 用文件级哈希，均完成可启动检查。未校验的旧 `.ready` 目录不会直接采用，需重新安装。

浏览器端口在首次动作才启动，驱动进程与浏览器子树登记到 supervisor；同工作区的资料目录串行准入，不同工作区与独立对话各自隔离。启动异常、取消与退出均清理已创建资源。定向检查：

```bash
uv run --locked python -m pytest tests/core/test_process_executor.py tests/core/test_components.py tests/core/test_execution_leases.py tests/core/test_shell_changes.py tests/core/test_tool_runtimes.py tests/core/test_agent_task_runner_cancel.py
```

Shell 首次执行前保存有界清单，确认子树停止后保存区间观察，同一核心内等待续接不覆盖起点，跨核心续接标为未知；`GET /api/sessions/{id}/runs/{run_id}/shell-changes` 和工作区对应入口支持分页，文件版本时间以十进制字符串传递。元数据变化无法归属到具体写入者，没有备份的脚本变化不能撤销；机制见[执行环境与限制](../../docs/architecture.md#执行环境与限制)。`test_shell_changes.py` 使用真实文件、进程和 SQLite，覆盖新增／修改／删除、外部并发、等待续接、截断、未知、重启后的读回和请求范围。运行时归档用例检查损坏不发布、修复重装、版本及动态库独立；真实模型效果需在完整包另行运行，不能由这些用例推断。

组件用例使用真实 SQLite 核对请求幂等、HTTP、取消、失败重试、重启接管与迟到发布隔离。真实运行时／组件检查显式启用：

```bash
RAY_TEST_TOOL_RUNTIMES=1 uv run --locked python -m pytest tests/core/test_process_executor.py tests/core/test_tool_runtimes.py
RAY_TEST_COMPONENTS=1 RAY_TEST_CHROMIUM_ARCHIVE=/absolute/path/chromium-mac-arm64.zip \
  uv run --locked python -m pytest tests/core/test_components.py
```

浏览器压缩包须来自随包固定地址并匹配清单哈希；真实用例检查 OCR worker、Chromium 可启动、资料隔离与同区复用、下载归属及停止回收。它不替代完整应用内安装、断网和退出重启走查，更不证明真实模型或无开发环境 Mac 的交付条件。

实现入口见[代码地图](../../docs/code-map.md)。
