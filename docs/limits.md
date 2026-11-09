# 运行参数与限额

本页登记当前源码里的默认值和硬编码限额。调整时只改本页和对应源码；产品说明、Harness、架构与设计说明不重复这些数字。界面像素、颜色和动效以 `ray_agent/ui` 的样式与组件为准。背景里的窗口、模型和采样是当次实验条件，不随默认值改写。

| 数值类型 | 阅读方式 |
|---|---|
| 默认值 | 未显式配置时采用，可被配置或运行快照改变 |
| 允许范围与目录上限 | 配置校验或模型能力封顶，不等于当前实际值 |
| 实现限制 | 由代码固定，修改需要同步实现与本页 |
| 派生预算 | 根据模型、输出预留与当前输入计算，不能只看一个默认窗口 |

应用配置（模型、Agent、工具策略、MCP、A2A）保存在业务库，首次启动按代码默认值写入，未保存的分区使用代码默认；模型地址与密钥只从用户配置文件读取。核心进程设置与环境变量名称见 [config.py](../ray_agent/api/core/config.py) 与 [API 开发指南](../ray_agent/api/README.md)。

## 模型与上下文

| 项 | 当前值 | 来源 |
|---|---|---|
| 默认协议 | `responses`；端点可显式改为 `chat_completions` | [app_config.py](../ray_agent/api/app/domain/models/app_config.py) 的 `LLMConfig.api_protocol` |
| 默认模型 | `deepseek-flash` | [app_config.py](../ray_agent/api/app/domain/models/app_config.py) 的 `LLMConfig.model_name` |
| 应用默认窗口 / 输出上限 / 温度 | 200000 tokens / 8192 tokens / 0.7 | `LLMConfig`、`ModelSampling` |
| 请求超时 | 默认 3600 秒，配置允许大于 0 且不超过 86400 秒。非流式是整次等待；流式是首个分片以及相邻分片的空闲间隔 | `LLMConfig.request_timeout` |
| DeepSeek 目录窗口 / 最大输出 | 1000000 / 393216 tokens | [model_catalog.py](../ray_agent/api/app/domain/models/model_catalog.py) 的 `deepseek_models()` |
| DeepSeek 思考开启时的输出下限 | 32768 | 同上，`thinking_output_floor` |
| GPT 目录窗口 / 最大输出 | 200000 / 128000 tokens。应用配置再高也会封顶到目录窗口 | `model_catalog.py` 的 `_gpt_spec()` |
| GPT 思考输出下限 | 0 | 同上 |
| 已知模型温度校验 | 0–2；思考开启时不发送温度 | `model_catalog.py`、配置服务 |
| 容量字符估算 | 中日韩字符 0.7 token/字符，其余 0.3；每条消息附加 4 tokens；获得 usage 后校准 | [context/budget.py](../ray_agent/api/app/domain/services/context/budget.py) |
| 安全余量 | 默认窗口的 5%，配置比例允许 0 至小于 0.5 | `AgentConfig.context_safety_ratio` |
| 可用输入 | 窗口 − 输出预留 − 安全余量。思考开启时，输出预留先抬到该模型的下限，再封顶到最大输出 | [budget.py](../ray_agent/api/app/domain/services/context/budget.py)、`tuned_limits()` |

已知模型用 `model_profiles` 里的窗口、输出上限和温度，再封顶到目录。对话第一次运行记下当时的三项；之后改设置只影响新对话，对话里换模型则用目标模型当前的数值。


## 请求预算、压缩与结果

| 项 | 当前值 | 来源 |
|---|---|---|
| 模型请求上限 | 默认 100，允许 1–999。从最近一条用户消息累计；重试和压缩摘要计入；补充消息与提问回复重新计算；审批续接沿用 | `AgentConfig.max_iterations` |
| 分阶段门槛 | 上限不小于 10 才分提醒和收尾 | [run_budget.py](../ray_agent/api/app/domain/services/run_budget.py) 的 `MIN_PHASED_LIMIT` |
| 提醒 / 收尾 | 用到 70% 提醒一次；最后 10% 且至少 2 次进入收尾 | `REMIND_RATIO`、`FINALIZE_RATIO`、`MIN_FINALIZE_RESERVE` |
| 模型普通尝试 | 默认最多 3 次尝试（含首次），配置允许 2–9，覆盖可重试传输错误、流中断和空回复；尝试间默认等待 1 秒 | `AgentConfig.max_retries`、[agent_loop.py](../ray_agent/api/app/domain/services/flows/agent_loop.py) |
| 连接未建立的重试 | 最多再试 5 次，按 1、2、4、8、15 秒等待；不占普通尝试额度，但仍计入请求上限 | `agent_loop.py` 的 `_CONNECT_BACKOFF` |
| 模型 HTTP 连接池 | 最多 1000 个连接、100 个空闲连接，空闲保留 30 秒；Responses 完整终态后最多再读 1 秒尾部 | [openai_llm.py](../ray_agent/api/app/infrastructure/external/llm/openai_llm.py) |
| 手动压缩期限 | 服务端 60 秒，前端等待 70 秒 | [agent_service.py](../ray_agent/api/app/application/services/agent_service.py)、[api/session.ts](../ray_agent/ui/src/lib/api/session.ts) |
| 压缩水位 | 默认可用输入上限的 75%，配置允许大于 0 且不超过 1 | `AgentConfig.compact_watermark` |
| 压缩保留轮数 | 默认 3，允许 1–20；保留区过大时减到 1 | `compact_keep_turns` |
| 近期保留区目标 | 系统提示、工具声明及近期保留区不超过压缩水位的 60%；不足时减少保留轮数，最后一轮仍保留 | [compactor.py](../ray_agent/api/app/domain/services/context/compactor.py) 的 `KEPT_WATERMARK_SHARE` |
| 普通水位压缩最小收益 | 可摘要历史减去原文重注入成本的估算，不少于可用输入上限的 15%；强制及手动压缩不使用该门槛 | [compaction.py](../ray_agent/api/app/domain/services/context/compaction.py) 的 `MIN_GAIN_RATIO` |
| 摘要请求单条材料 | 助手正文、调用参数及工具正文各按 2000 字符裁剪；用户正文 4000，旧摘要 12000；保留首部 75% 与尾部 25% | `ENTRY_MAX_CHARS`、`USER_ENTRY_MAX_CHARS`、`_clip()` |
| 重新注入的用户原文 | 总计 16000 字符，从最近向前整条选取，遇超额停止 | `compact_user_chars`、`select_reinjection()` |
| 单条工具结果 | 8000 字符，超出写入会话工作目录并给首尾预览 | `tool_result_max_chars` |
| 独立读取并发 | 整批都是允许的独立读取时最多 3 项 | [tool_pipeline.py](../ray_agent/api/app/domain/services/flows/tool_pipeline.py) 的 `read_batch()` |
| 同一核验再执行 | 记录尝试数不少于 2 且当前未通过时，需说明新条件或换方法；修复改版的必要复验有例外 | [task_outcomes.py](../ray_agent/api/app/domain/services/task_outcomes.py) |
| 收尾补写 | 每项成功写入 1 次，或尝试达到 2 次后拒绝；单次内容最多 1000000 字符 | `finalize_artifact()` |
| 检索条数 | 默认 10，允许 2–29 | `AgentConfig.max_search_results` |

收尾只放行读取、交付、更新计划和受限文本补写。识别等待「不超过 15 秒、最多等一次」写在图片提示词 [图片提示词](../ray_agent/api/app/domain/services/prompts/image_input.py)，不是独立配置项。

## 本机存储与后台任务

| 项 | 当前值 | 来源 |
|---|---|---|
| 业务库 busy 等待 | 每条语句 5000 毫秒，`SQLITE_BUSY_TIMEOUT_MS` | [core/config.py](../ray_agent/api/core/config.py)、[sqlite.py](../ray_agent/api/app/infrastructure/storage/sqlite.py) |
| 开始写事务的尝试 | 最多 3 次（含首次），`SQLITE_BEGIN_ATTEMPTS`；第 n 次失败后等待 0.2 × n 秒；用尽后返回 503，建议 1 秒后重试 | 同上，`_RETRY_DELAY_SECONDS`；[exception_handlers.py](../ray_agent/api/app/interfaces/errors/exception_handlers.py) |
| 连接 | 写连接 1 个；读连接 4 个，`SQLITE_READ_POOL_SIZE`；取连接最多等待 30 秒 | `sqlite.py` |
| 后台任务 | 同时执行 2 个，`BACKGROUND_JOB_CONCURRENCY`；无唤醒时每 30 秒检查一次，`BACKGROUND_JOB_POLL_SECONDS` | [background_jobs.py](../ray_agent/api/app/application/services/background_jobs.py)、`core/config.py` |
| 周期回收 | 启动时及每 30 秒回收过期 skill 包与临时图 | [app/main.py](../ray_agent/api/app/main.py) |
| 关闭等待 | 受理后未登记的启动最多等 10 秒；运行任务收尾最多等 20 秒 | `app/main.py` |
| 停止后等待协程 | 10 秒；也是工作区写入租约确认写入者已退出的期限，期限内未确认租约转为阻止状态，等用户重试收尾 | [agent_task_runner.py](../ray_agent/api/app/domain/services/agent_task_runner.py) 的 `STOP_SETTLE_SECONDS` |

## 工作区文件夹与文件访问

| 项 | 当前值 | 来源 |
|---|---|---|
| 默认工作区位置 | `~/RayAgent`；用户经宿主选择器更改后保存在应用配置 | [core/config.py](../ray_agent/api/core/config.py) 的 `workspace_default_location` |
| 不能作为工作区的系统目录 | `/System`、`/Library`、`/usr`、`/bin`、`/sbin`、`/private`、`/etc`、`/var`、`/Applications`、`/dev`、`/proc`、`/sys`、`/boot`、`/lib`、`/lib64`、`/run`；另外拒绝文件系统根、用户主目录及其上级、数据根及其上级与下级、与已有工作区嵌套的位置 | `workspace_blocked_paths`、[folder_policy.py](../ray_agent/api/app/application/services/folder_policy.py) |
| 文件夹授权凭证 | 有效 300 秒、一次使用；内存最多 64 个，超出时丢弃最早的 | `folder_grant_seconds`、`folder_grant_capacity` |
| 复制冲突等待选择 | 600 秒；内存最多 32 个 | `marker_conflict_seconds`、[workspace_service.py](../ray_agent/api/app/application/services/workspace_service.py) 的 `CONFLICT_CAPACITY` |
| 工作区名称与新建文件夹名 | 名称最多 80 个字符；文件夹名最多 60 个字符，重名加序号 | [workspace.py](../ray_agent/api/app/domain/models/workspace.py) 的 `WORKSPACE_NAME_MAX_LENGTH`、`workspace_service.py` 的 `FOLDER_NAME_MAX_LENGTH` |
| 身份标记读取 | 最多读 64 KiB；无法解析的标记不改写 | [folders.py](../ray_agent/api/app/infrastructure/external/workspace_files/folders.py) |
| 单次读取 | 4 MiB（调用方可要求更小）；`read_file` 用 `max_length` 截断并标记 `truncated`，大文件不整体读入内存 | `file_read_bytes` |
| 单个目录列举 | 2000 项，超出标记截断 | `file_list_entries` |
| 打开文件夹的规模扫描 | 访问最多 50000 项、深度 32 层，超出标记截断；只统计排除规则之外的内容 | `file_scan_entries`、`file_scan_depth` |
| 单个文件写入 | 2 GiB | `file_write_bytes` |
| 文件内搜索 | 最多 200 个匹配行 | `file_search_matches` |
| 按名称查找 | 最多返回 500 条、访问最多 20000 项 | `file_find_results`、`file_find_entries` |
| 文件名 | 最多 255 个字符；放入文件夹时同名加序号，最多尝试 500 次 | [file_rules.py](../ray_agent/api/app/domain/services/file_rules.py)、[file_scope.py](../ray_agent/api/app/domain/services/file_scope.py) 的 `UNIQUE_NAME_ATTEMPTS` |
| 写前备份的空间预留 | 数据卷可用空间低于 64 MiB 加本次备份大小时停止发布新版本，不删除任何已保存的版本 | `backup_free_reserve_bytes` |
| schema 升级前副本 | 业务库升级前用 SQLite 备份接口写入数据根 `upgrades/`；路径与失败拒绝见 `backup_before_upgrade()` | [sqlite.py](../ray_agent/api/app/infrastructure/storage/sqlite.py)、[paths.py](../ray_agent/api/core/paths.py) |
| 撤销预览 | 当前版本与将恢复版本每侧最多读 256 KiB，统一 diff 最多 2000 行；超出只给大小 | `change_preview_bytes`、`change_preview_lines` |
| 最近修改的运行 | 默认返回 20 条，最多 100 条 | `change_runs_default` |
| 写入临时文件残留 | 核心启动后与打开文件夹时，清理超过 1 小时的 `.rayagent-write-*.tmp`（只处理本应用命名的普通文件）；这类文件在列举、扫描与监视中一律不可见 | [workspace_service.py](../ray_agent/api/app/application/services/workspace_service.py) 的 `TEMP_MAX_AGE_SECONDS` |
| 删除工作区等待写入者 | 最多 10 秒等待文件夹的写入租约结束，期限内仍有写入者则返回冲突，不删除 | `workspace_service.py` 的 `DELETE_QUIESCE_SECONDS` |
| 文件描述符软上限 | 核心启动时提高到 4096（不超过系统硬上限）；目录遍历按相对路径逐层打开，不依赖这个值 | [app/main.py](../ray_agent/api/app/main.py) 的 `NOFILE_TARGET` |
| 外部变更监视 | 通知合并窗口 300 毫秒；监听期间每 2 秒核对文件夹是否仍在原处；每 30 秒兜底重扫一次（规模上限同打开文件夹的扫描）；一次事件最多列 200 个路径，超出改为整体刷新 | `watch_debounce_ms`、`workspace_probe_seconds`、`workspace_rescan_seconds`、`change_paths_per_event` |
| 外部变更订阅者队列 | 每个订阅者 64 条，写满时合并为一次整体刷新 | [workspace_changes.py](../ray_agent/api/app/application/services/workspace_changes.py) 的 `queue_size` |

列举、搜索与扫描共用排除规则（版本控制目录、依赖目录、常见凭证与数据库文件）和保留目录 `.rayagent`。模型文件工具对工作区文件夹内的 `.rayagent`、版本控制内部目录（任一路径段）、凭据与数据库文件（最后一段）显式读写同样拒绝并给出原因；依赖缓存目录只从列举、搜索与扫描中排除，显式读取仍允许；会话工作目录不适用这条规则。`/api/roots/…` 文件接口只拒绝 `.rayagent`、符号链接与特殊文件。

## 协议

| 项 | 当前值 | 来源 |
|---|---|---|
| MCP 连接 / 发现 / 调用 | 10 / 15 / 120 秒 | [app_config.py](../ray_agent/api/app/domain/models/app_config.py) 的 `ProtocolTimeouts` |
| MCP / A2A 全局发现预算 | 20 秒 | `MCPConfig`、`A2AConfig.discovery_budget` |
| A2A 连接 / 发现 | 10 / 15 秒 | `ProtocolTimeouts` |
| A2A 调用 / 取消 | 600 / 5 秒 | `A2A` 配置字段 |
| A2A 轮询间隔 | 从 1 秒起每次乘 1.5，封顶 5 秒 | [a2a.py](../ray_agent/api/app/infrastructure/protocols/a2a.py) |
| 外部结果预览 | 文本 16000 字符、列表 100 项；截断前完整内容交给统一整形 | 协议 [common.py](../ray_agent/api/app/infrastructure/protocols/common.py) |

## 公开网页读取

| 项 | 当前值 | 来源 |
|---|---|---|
| 传输及解压内容 | 各最多 2 MiB | [public_page.py](../ray_agent/api/app/infrastructure/external/web/public_page.py) 的 `MAX_BYTES` |
| 重定向 | 最多 3 跳 | 同上，`MAX_REDIRECTS` |
| 单跳 HTTP / 全过程 | 8 秒 / 15 秒 | 同上 |
| 代理假地址核对 | 每个 DNS-over-HTTPS 端点 3 秒，三个端点依次回退，计入全过程时限 | 同上，`DOH_TIMEOUT_SECONDS`、`DOH_ENDPOINTS` |
| 返回正文 | 最多 6000 字符 | 同上，`CONTENT_CHARS` |

## 本机执行与组件安装

| 项 | 当前值 | 来源 |
|---|---|---|
| 安装 worker 单阶段期限 | 获取／校验各 600 秒 | [component_service.py](../ray_agent/api/app/application/services/component_service.py) 的 `WORKER_TIMEOUT_SECONDS` |
| 安装取消检查 | 每次等待子进程最多 0.25 秒后复核 | 同上，`WORKER_POLL_SECONDS` |
| 组件下载请求超时 | 600 秒 | [install_files.py](../ray_agent/api/app/infrastructure/external/components/install_files.py) 的 `fetch_file()` |
| 设置组件状态轮询 | 2 秒，离开分区后停止 | [components-section.tsx](../ray_agent/ui/src/components/settings/components-section.tsx) |
| 基础工具版本与架构 | CPython 3.12.12、Node 22.20.0；macOS arm64 | [tool_runtime_manifest.json](../ray_agent/api/resources/tool_runtime_manifest.json)；组件版本以各固定清单为准 |

## 浏览器、截图与用户图片

| 项 | 当前值 | 来源 |
|---|---|---|
| 视口宽高 | 240–3840 | [playwright_browser.py](../ray_agent/api/app/infrastructure/external/browser/playwright_browser.py)、`browser.py` |
| 浏览器连接 / 动作 / 导航 | CDP 连接 10 秒，页面动作默认 5 秒，导航 15 秒 | `playwright_browser.py` |
| 页面观察等待 / 提取 | 等待文本默认 5000 ms，可设 1–10000 ms；提取最多 8 秒 | 同上，`view_page()` |
| DOM 提取内部上限 | 30000 节点、1000000 字符、500 个元素 | [playwright_browser_fun.py](../ray_agent/api/app/infrastructure/external/browser/playwright_browser_fun.py) 的 `OBSERVE_PAGE` |
| 浏览器日志 | 每标签页保留 300 项，单项 2000 字符 | `playwright_browser.py` |
| 页面观察默认 | 正文 6000 字符、元素 80 个；可调范围 200–20000 与 1–200 | `view_page()` |
| 浏览器脚本 / 截图捕获 | 各 8 秒 | `playwright_browser.py` |
| 单张截图 | 8 MiB、最长边 8192、1600 万像素 | `playwright_browser.py` |
| 视觉分析图 | 最长边 2048、2 MiB | 同上 |
| 每运行截图 | 8 次或 24 MiB；捕获与存储共 20 秒 | `agent_task_runner.py` |
| 临时图保留 | 24 小时，且运行已进入终态后才回收字节 | 同上，`86400` |
| 发往模型的图片 | 每请求最多 2 张；容量估算每张至少 1024 tokens | [vision.py](../ray_agent/api/app/domain/services/context/vision.py)、`budget.py` |
| 用户原图 | 20 MiB、4000 万像素；PNG、JPEG、WebP、GIF 首帧 | [image_input.py](../ray_agent/api/app/infrastructure/external/file_storage/image_input.py) |
| 用户图输入副本 | 最长边 2048、2 MiB；每条消息最多 2 张进入像素输入 | 同上，`MAX_MESSAGE_IMAGES` |

## 预览与下载

| 项 | 当前值 | 来源 |
|---|---|---|
| 文本分页 | 64 KiB | [file_preview.py](../ray_agent/api/app/domain/models/file_preview.py) 的 `TEXT_PAGE_BYTES` |
| 表格窗口 | 200 行、50 列；行起点最高 100000 | `TABLE_PAGE_ROWS`、`TABLE_PAGE_COLUMNS`、`PreviewQuery` |
| 解析输入 / 工作簿解压 | 64 MiB / 128 MiB；工作簿条目超过 10000 个拒绝 | `PREVIEW_INPUT_BYTES`、`WORKBOOK_EXPANDED_BYTES`、[worker.py](../ray_agent/api/app/infrastructure/external/file_preview/worker.py) |
| 预览位图像素 / 缩略图 | 约 3355 万像素（`32 * 1024 * 1024`）；缩略图最长边 1600 | `IMAGE_MAX_PIXELS`、`worker.py` |
| 解析进程 | 最多 3 个；墙钟 12 秒、CPU 10 秒；Linux 地址空间 768 MiB | [parser.py](../ray_agent/api/app/infrastructure/external/file_preview/parser.py)、`worker.py` |
| 派生缓存 | 64 项或 32 MiB，保留 60 秒；单项 JSON 长度小于 8 MiB 才缓存 | `parser.py` |
| 表格文字 | CSV 字段解析上限 65536；单元格显示 4096 字符，整窗口显示 1048576 字符 | `worker.py` |
| 附件 ZIP | 1–100 个文件，实际总量 512 MiB | [file_service.py](../ray_agent/api/app/application/services/file_service.py)、[file_routes.py](../ray_agent/api/app/interfaces/endpoints/file_routes.py) |

预览不按单一文件大小整份禁用。超限时 CSV 可看已取得前缀，其他二进制降级为下载。原文件下载不受预览预算限制。

## 工作方式与记忆

| 项 | 当前值 | 来源 |
|---|---|---|
| 工作方式正文 | 最多 4000 字符；整段进入每次新运行的系统提示 | [working_style.py](../ray_agent/api/app/domain/models/working_style.py) 的 `INSTRUCTION_MAX_CHARS` |
| 模板名称 / 工作区列表里的工作方式预览 | 名称最多 80 字符；预览 120 字符 | [working_style_service.py](../ray_agent/api/app/application/services/working_style_service.py) 的 `TEMPLATE_NAME_MAX_CHARS`、[workspace_service.py](../ray_agent/api/app/application/services/workspace_service.py) 的 `INSTRUCTION_PREVIEW_CHARS` |
| 单条记忆内容 | 最多 2000 字符 | [workspace_memory.py](../ray_agent/api/app/domain/models/workspace_memory.py) 的 `MEMORY_CONTENT_MAX_CHARS` |
| 常驻层 | 每次新运行最多注入 12 条；钉住的先，其次约束、偏好、决定、事实，再按最近使用或更新 | `RESIDENT_MEMORY_LIMIT`、`MEMORY_TYPE_RANK`、[memory_rules.py](../ray_agent/api/app/domain/services/memory_rules.py) 的 `select_resident()` |
| 初始召回 | 以用户问题在本工作区检索记忆、会话摘要与文件片段，最多 8 条、片段合计 4000 字符，超出的记入“本次参考”的未采用原因；问句检索任一词命中即可，最多取 24 个检索词 | [retrieval.py](../ray_agent/api/app/domain/models/retrieval.py) 的 `INITIAL_RECALL_LIMIT`、`INITIAL_RECALL_CHARS`、[chinese_tokenize.py](../ray_agent/api/app/domain/services/chinese_tokenize.py) 的 `ANY_TERM_LIMIT` |
| 检索命中 | 单次最多 20 条，接口允许 1–100；单条片段最多 400 字符；检索词最多 500 字符 | `SEARCH_HIT_LIMIT`、[db_search_repository.py](../ray_agent/api/app/infrastructure/repositories/db_search_repository.py) |

## 文档知识索引

| 项 | 当前值 | 来源 |
|---|---|---|
| 单文件解析输入 | 最多 32 MiB | [document_knowledge.py](../ray_agent/api/app/domain/models/document_knowledge.py) 的 `DOCUMENT_PARSE_MAX_BYTES` |
| 文本片段长度／重叠 | 800／80 字符 | `DOCUMENT_CHUNK_CHARS`、`DOCUMENT_CHUNK_OVERLAP` |
| 表格行组 | 每组最多 40 行（保留表头） | `DOCUMENT_TABLE_ROWS_PER_CHUNK` |
| 解析进程 | 最多 2 个并发；墙钟 120 秒 | [runner.py](../ray_agent/api/app/infrastructure/external/document_parse/runner.py) 的 `DOCUMENT_PARSE_SLOTS`、`DOCUMENT_PARSE_TIMEOUT_SECONDS` |
| 解析配置指纹 | `p6-parse-v1`／`p6-chunk-v1` | `PARSE_CONFIG_FINGERPRINT`、`CHUNK_CONFIG_FINGERPRINT` |
| Embedding 配置指纹／维度／上限 | `e5-small-onnx-v1`；384 维；512 tokens；批大小 8 | [semantic_index.py](../ray_agent/api/app/domain/models/semantic_index.py) 的 `EMBEDDING_*` |
| RRF 融合 | `k=60`；向量候选最多 40；语义写入批 32 | `RRF_K`、`VECTOR_SEARCH_LIMIT`、`SEMANTIC_INDEX_CHUNK_BATCH` |
| 组件身份 | `embedding-e5`、`ocr` | 同文件；清单 [component_manifest.json](../ray_agent/api/resources/component_manifest.json) |
| LanceDB 路径 | `<data_root>/indexes/lancedb/<workspace_id>/<embedding_config>/` | [lancedb_store.py](../ray_agent/api/app/infrastructure/external/vector_store/lancedb_store.py)、[paths.py](../ray_agent/api/core/paths.py) 的 `indexes` |
| 索引重扫 | 与文件夹兜底重扫同间隔（默认 30 秒） | [document_index_scheduler.py](../ray_agent/api/app/application/services/document_index_scheduler.py)、`workspace_rescan_seconds` |
| 自动提炼 | 每次最多提出 5 条候选、最多落地 8 条；每条候选判定时参考最多 5 条相似活动条目 | [memory_extractor.py](../ray_agent/api/app/application/services/memory_extractor.py) 的 `PROPOSE_MAX_FACTS`、[memory_service.py](../ray_agent/api/app/application/services/memory_service.py) 的 `EXTRACTION_MAX_ITEMS`、[memory_jobs.py](../ray_agent/api/app/application/services/memory_jobs.py) 的 `SIMILAR_LIMIT` |
| 提炼与判定请求 | 输出上限 800，温度 0.1，请求超时 30 秒，调用等待 35 秒；用量单独记录 | `memory_extractor.py` 的 `LLMMemoryExtractor` |

## 会话摘要

| 项 | 当前值 | 来源 |
|---|---|---|
| 单份摘要 / 多会话注入 | 单份最多 1500 字符；最多取 10 份，注入文字总计 1500 字符，包含来源前缀 | [session_summary.py](../ray_agent/api/app/application/services/session_summary.py) 的 `SUMMARY_MAX_CHARS`、`bounded_summaries()` |
| 生成摘要的材料 | 消息正文合计最多 6000 字符；首条用户消息最多 1600；近期更新、完成回复和运行状态各取最多 12 项，更新每项最多 300、完成回复每项最多 600 字符 | [summary_material.py](../ray_agent/api/app/domain/services/summary_material.py) 的 `bound_material()` |

## 辅助请求

| 项 | 当前值 | 来源 |
|---|---|---|
| 会话标题 | 输出上限 256，温度 0.2，请求超时 20 秒，外层等待 23 秒 | [title_service.py](../ray_agent/api/app/application/services/title_service.py) |
| 会话摘要 | 输出上限 512，温度 0.2，请求超时 20 秒，调用等待 23 秒；运行正常结束后由后台任务生成，工作区会话允许参与记忆时才登记 | [session_summary.py](../ray_agent/api/app/application/services/session_summary.py) 的 `generate_summary()` |

辅助请求是否发送温度仍按模型目录规则决定。

## 事件与界面轮询

| 项 | 当前值 | 来源 |
|---|---|---|
| 事件补查分页 | 每页 200 项 | `agent_service.py` 的 `EVENT_PAGE_SIZE` |
| 事件流兜底 | 有活动或刚有进展时 3 秒；连续空闲 2 次后 30 秒 | `agent_service.py` 的 `FALLBACK_POLL_SECONDS`、`IDLE_POLL_SECONDS` |
| 进程内通知队列 | 每个订阅者 256 项，满时丢弃最旧一项，订阅者按序号补读 | [local_notifier.py](../ray_agent/api/app/infrastructure/external/notification/local_notifier.py) 的 `QUEUE_SIZE` |
| 目录通知兜底 | 30 秒 | [session_routes.py](../ray_agent/api/app/interfaces/endpoints/session_routes.py) 的 `CATALOG_FALLBACK_SECONDS` |
| 前端断线重连 | 500 毫秒起，每次翻倍，上限 4 秒；会话事件流与文件夹变更流共用 | [session-projection.ts](../ray_agent/ui/src/lib/session-projection.ts) |
| 文件夹变更合并窗口 | 最后一次通知后 300 毫秒才交出一批刷新 | [workspace-live-provider.tsx](../ray_agent/ui/src/providers/workspace-live-provider.tsx) 的 `CHANGE_DEBOUNCE_MS` |
| 写入租约轮询 | 有租约时每 3 秒读一次，直到释放；回到前台再读一次 | [workspace-live-provider.tsx](../ray_agent/ui/src/providers/workspace-live-provider.tsx) 的 `LEASE_POLL_MS` |
| 回到前台的重新核对 | 文件夹树与工作区列表距上次读取超过 5 秒才重读 | [use-folder-tree.ts](../ray_agent/ui/src/hooks/use-folder-tree.ts)、[workspaces-provider.tsx](../ray_agent/ui/src/providers/workspaces-provider.tsx) 的 `FOCUS_RELOAD_MS`、`FOCUS_REFRESH_MS` |
| 压缩状态轮询 | 进行中每 3 秒读一次会话详情 | [use-session-detail.ts](../ray_agent/ui/src/hooks/use-session-detail.ts) |
| 终端输出轮询 | 命令运行中每 1.5 秒 | [workbench.tsx](../ray_agent/ui/src/components/workbench/workbench.tsx) |

跟随底部的距离、缩略图边长和图标尺寸在组件里，不在本页登记。

## 共享契约

| 项 | 当前值 | 来源 |
|---|---|---|
| 身份长度 | 不透明身份 1–128 个字符 | [identity.py](../ray_agent/api/app/domain/models/identity.py) 的 `ID_MAX_LENGTH` |
| 相对路径长度 | 最长 4096 个字符 | 同上，`RELATIVE_PATH_MAX_LENGTH` |

## 桌面宿主与核心进程

| 项 | 当前值 | 来源 |
|---|---|---|
| 核心连接收尾 | 正常停止时最多等待开放连接 5 秒 | [sidecar.py](../ray_agent/api/sidecar.py) 的 `GRACEFUL_SHUTDOWN_SECONDS` |
| 宿主失联后的核心自退 | stdin 关闭后 20 秒仍未退出则直接结束进程 | 同上，`EXIT_DEADLINE_SECONDS` |
| 宿主退出等待 | 关闭核心 stdin 后等待 25 秒，再发 SIGTERM 等待 3 秒，随后 SIGKILL 整个进程组 | [sidecar.rs](../ray_agent/desktop/src/sidecar.rs) 的 `EXIT_GRACE`、`TERM_GRACE` |
| 健康检查 | 握手后带令牌请求一次 `/api/status`，连接与读写各 5 秒 | 同上，`HEALTH_TIMEOUT` |
| 宿主保留的核心日志 | 最近 200 行；失败时向界面给出最后 40 行 | 同上，`LOG_LINES`、`FAILURE_LOG_LINES` |
| 退出请求回应 | 界面 2 秒内未回应 `quit_ack` 则宿主直接退出 | [lib.rs](../ray_agent/desktop/src/lib.rs) 的 `QUIT_ACK_TIMEOUT` |
| 宿主代为下载 | 连接与读取各 30 秒 | [platform.rs](../ray_agent/desktop/src/platform.rs) 的 `DOWNLOAD_TIMEOUT` |
| 资源票据 | 有效 600 秒；进程内最多保留 1024 张，超出时丢弃最早签发的 | [config.py](../ray_agent/api/core/config.py) 的 `resource_ticket_seconds`、`resource_ticket_capacity` |
| 界面重新申请票据 | 缓存的票据剩余不足 60 秒时重新申请 | [preview.ts](../ray_agent/ui/src/lib/api/preview.ts) 的 `TICKET_REFRESH_MS` |
| 界面读取核心状态 | 启动中每 250 毫秒，就绪后每 2 秒；启动超过 400 毫秒才显示等待画面 | [core-gate.tsx](../ray_agent/ui/src/components/core-gate.tsx) 的 `STARTING_POLL_MS`、`READY_POLL_MS`、`STARTING_NOTICE_DELAY_MS` |

宿主不限制核心从启动到握手的时间：新复制的 onedir 首次启动要经过 macOS 对原生库的首次加载检查，明显慢于再次启动。宿主退出等待长于核心自退期限，正常情况下核心先自行结束。

## skill

API 设置来自 `core/config.py`，环境变量使用对应大写名称；正文、目录及活动资料仍受实际模型窗口约束。

| 项 | 当前默认值或硬边界 | 来源 |
|---|---|---|
| skill 持久目录 | 数据根下的 `skills/`（`versions/` 内容快照、`previews/` 导入预览） | [paths.py](../ray_agent/api/core/paths.py) |
| 下载 / 解压累计 / 单文件 | 20 MiB / 50 MiB / 5 MiB | `skill_download_bytes`、`skill_package_bytes`、`skill_file_bytes` |
| 普通文件 / ZIP 条目 / 候选 | 2000 / 文件限额的两倍 / 100 | `skill_max_files`、`skill_max_candidates`、包解析器 |
| 路径 | 最多 20 层、4096 字符 | 包解析器与快照映射 |
| 名称 / 描述 / 完整 SKILL.md | 64 / 1024 / 60000 字符 | `skill_name_chars`、`skill_description_chars`、`skill_body_chars`；稳定 `skill_id` 上限 128，HTTP 文本输入硬边界 5 MiB 字符，仍由共享解析器检查正文预算 |
| 目录 / 活动正文及资料封装 | 24000 / 100000 字符 | `skill_catalog_chars`、`skill_active_chars`；纳入目录时核对完整索引，发现扫描不因超额失败。已纳入集合放不下时，新运行只自动带上内置 Skill，不按扫描顺序截断 |
| 目录索引中的描述 | 160 字符，超出以省略号截断 | `skill_catalog_description_chars`；索引只含名称、来源和这一行描述 |
| 资源单次文本及正文资源清单 | 8000 字符 | `skill_resource_chars`；超长单行转材料准备后读取 |
| 获取总时限 / 单次网络等待 / 尝试 | 90 秒 / 20 秒 / 最多 3 次 | `skill_fetch_seconds`、GitHub 适配器；引用不存在不重试 |
| 预览与孤立包保留门槛 | 3600 秒；启动和维护循环检查 | `skill_preview_seconds`、应用生命周期 |
| 发现范围 | 用户／工作区约定目录与设置中的额外目录；工作区只扫约定子目录一层包，不递归整棵文件树 | [skill_discovery.py](../ray_agent/api/app/domain/services/skill_discovery.py) |
| 设置导入 | 请求等待 120 秒，处理中每 1.5 秒查询原操作 | skill 客户端及设置组件 |

提高 API 文件限额时同时核对沙箱的独立硬边界；不会自动扩大沙箱接收范围。导入操作和版本元数据可供查询，回收文件不删除历史操作记录。
