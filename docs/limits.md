# 运行参数与限额

本页登记当前源码里的默认值和硬编码限额。调整时只改本页和对应源码；产品说明、Harness、架构与设计说明不重复这些数字。界面像素、颜色和动效以 `ray_agent/ui` 的样式与组件为准。背景里的窗口、模型和采样是当次实验条件，不随默认值改写。

| 数值类型 | 阅读方式 |
|---|---|
| 默认值 | 未显式配置时采用，可被配置或运行快照改变 |
| 允许范围与目录上限 | 配置校验或模型能力封顶，不等于当前实际值 |
| 实现限制 | 由代码固定，修改需要同步实现与本页 |
| 派生预算 | 根据模型、输出预留与当前输入计算，不能只看一个默认窗口 |

配置文件是 [`ray_agent/api/config.yaml`](../ray_agent/api/config.yaml)。未写入的字段使用代码默认。部署用环境变量的名称见[运行指南](../ray_agent/README.md)。

## 模型与上下文

| 项 | 当前值 | 来源 |
|---|---|---|
| 默认协议 | `responses`；端点可显式改为 `chat_completions` | [app_config.py](../ray_agent/api/app/domain/models/app_config.py) 的 `LLMConfig.api_protocol` |
| 默认模型 | `deepseek-flash` | `config.yaml` |
| 应用默认窗口 / 输出上限 / 温度 | 200000 tokens / 8192 tokens / 0.7 | `config.yaml` 与 `LLMConfig`、`ModelSampling` |
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

配置兼容迁移仅发生一次：加载配置时，版本标记把 DeepSeek 地址下仍为 131072 的全局窗口，以及 `deepseek-flash`、`deepseek-v4-pro` 里相同的旧窗口，迁到 200000 一次。已经改过的预算和会话里冻结的参数不迁移。来源是 [file_app_config_repository.py](../ray_agent/api/app/infrastructure/repositories/file_app_config_repository.py)。

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
| 单条工具结果 | 8000 字符，超出落盘并给首尾预览 | `tool_result_max_chars` |
| 独立读取并发 | 整批都是允许的独立读取时最多 3 项 | [tool_pipeline.py](../ray_agent/api/app/domain/services/flows/tool_pipeline.py) 的 `read_batch()` |
| 同一核验再执行 | 记录尝试数不少于 2 且当前未通过时，需说明新条件或换方法；修复改版的必要复验有例外 | [task_outcomes.py](../ray_agent/api/app/domain/services/task_outcomes.py) |
| 收尾补写 | 每项成功写入 1 次，或尝试达到 2 次后拒绝；单次内容最多 1000000 字符 | `finalize_artifact()` |
| 检索条数 | 默认 10，允许 2–29 | `AgentConfig.max_search_results` |

收尾只放行读取、交付、更新计划和受限文本补写。识别等待「不超过 15 秒、最多等一次」写在图片提示词 [图片提示词](../ray_agent/api/app/domain/services/prompts/image_input.py)，不是独立配置项。

## 沙箱与 Shell

| 项 | 当前值 | 来源 |
|---|---|---|
| 内存 / CPU / 进程数 | 2048 MiB / 2 / 512。环境变量 `SANDBOX_MEMORY_MB`、`SANDBOX_CPUS`、`SANDBOX_PIDS_LIMIT`；已有地址模式不套用 | [core/config.py](../ray_agent/api/core/config.py) |
| 存活时间 | 60 分钟，`SANDBOX_TTL_MINUTES` 注入为沙箱的 `SERVER_TIMEOUT_MINUTES` | 同上 |
| 沙箱 HTTP 超时 | 600 秒 | [docker_sandbox.py](../ray_agent/api/app/infrastructure/external/sandbox/docker_sandbox.py) 的 `SANDBOX_HTTP_TIMEOUT_SECONDS` |
| 命令初次等待 | 5 秒，未结束则返回 running | [shell.py](../ray_agent/sandbox/app/services/shell.py) 的 `EXEC_FOREGROUND_SECONDS` |
| 等待进程 | 未指定时 60 秒；上限 570 秒（HTTP 超时减 30 秒） | `shell.py`；`SHELL_WAIT_MAX_SECONDS` |
| 会话输出 | 1 MB（按字符计），超出保留尾部 | `OUTPUT_LIMIT_CHARS` |
| 进程组宽限 | SIGTERM 后 3 秒仍有进程则 SIGKILL | `PROCESS_GROUP_GRACE_SECONDS` |
| 停止后等待协程 | 10 秒 | [agent_task_runner.py](../ray_agent/api/app/domain/services/agent_task_runner.py) 的 `STOP_SETTLE_SECONDS` |

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
| 传输及解压内容 | 各最多 2 MiB | 沙箱 [services/web.py](../ray_agent/sandbox/app/services/web.py) 的 `MAX_BYTES` |
| 重定向 | 最多 3 跳 | 同上，`MAX_REDIRECTS` |
| 单跳 HTTP / 全过程 | 8 秒 / 15 秒 | 同上 |

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

## 预览、下载与项目文件

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
| 运行前快照 | 默认 5 份，允许 1–7 份 | `AgentConfig.project_snapshot_retention` |
| 项目上传 | 单文件 50 MiB，单次最多 2000 个文件或 200 MiB，项目总量 500 MiB | `core/config.py` |

预览不按单一文件大小整份禁用。超限时 CSV 可看已取得前缀，其他二进制降级为下载。原文件下载不受预览预算限制。

## 项目记忆

| 项 | 当前值 | 来源 |
|---|---|---|
| 项目说明 / 笔记 | 各最多 8000 字符；笔记整体替换，按基础版本比较 | [workspace_project.py](../ray_agent/api/app/domain/models/workspace_project.py)、[project_memory_service.py](../ray_agent/api/app/application/services/project_memory_service.py) |
| 单份对话摘要编辑 | 最多 1500 字符 | `ProjectMemoryService.edit_summary()` |
| 近期摘要选择 / 注入 | 排除当前会话，最多选近期 10 份；注入文字总计 1500 字符，包含来源前缀 | [db_session_repository.py](../ray_agent/api/app/infrastructure/repositories/db_session_repository.py) 的 `recent_summaries()`、[project.py](../ray_agent/api/app/domain/services/prompts/project.py) 的 `bounded_summaries()` |
| 生成摘要的材料 | 消息正文合计最多 6000 字符；首条用户消息最多 1600；近期更新、完成回复和运行状态各取最多 12 项，更新每项最多 300、完成回复每项最多 600 字符 | [summary_material.py](../ray_agent/api/app/domain/services/summary_material.py) 的 `bound_material()` |

说明与笔记的上限约束内容写入，不自动替用户做语义去重；历史材料保留与本次注入预算是不同问题。辅助生成的期限与输出上限见下节。

## 辅助请求

| 项 | 当前值 | 来源 |
|---|---|---|
| 会话标题 | 输出上限 256，温度 0.2，请求超时 20 秒，外层等待 23 秒 | [title_service.py](../ray_agent/api/app/application/services/title_service.py) |
| 项目对话摘要 | 输出上限 512，温度 0.2，请求超时 20 秒，调用等待 23 秒，生成任务等待 25 秒 | [project_memory_service.py](../ray_agent/api/app/application/services/project_memory_service.py) |
| 配置保存锁 | 等待 5 秒 | `file_app_config_repository.py` |

辅助请求是否发送温度仍按模型目录规则决定。

## 事件与界面轮询

| 项 | 当前值 | 来源 |
|---|---|---|
| 事件补查分页 | 每页 200 项 | `agent_service.py` 的 `EVENT_PAGE_SIZE` |
| 临时图维护 | 启动时及每 30 秒检查一次 | [app/main.py](../ray_agent/api/app/main.py) |
| 事件流兜底 | 有活动或刚有进展时 3 秒；连续空闲 2 次后 30 秒 | `agent_service.py` 的 `FALLBACK_POLL_SECONDS`、`IDLE_POLL_SECONDS` |
| 目录通知兜底 | 30 秒 | [catalog_notifier.py](../ray_agent/api/app/infrastructure/external/message_queue/catalog_notifier.py) 的 `CATALOG_FALLBACK_SECONDS` |
| 前端断线重连 | 500 毫秒起，每次翻倍，上限 4 秒 | [session-projection.ts](../ray_agent/ui/src/lib/session-projection.ts) |
| 压缩状态轮询 | 进行中每 3 秒读一次会话详情 | [use-session-detail.ts](../ray_agent/ui/src/hooks/use-session-detail.ts) |
| 终端输出轮询 | 命令运行中每 1.5 秒 | [workbench.tsx](../ray_agent/ui/src/components/workbench/workbench.tsx) |

跟随底部的距离、缩略图边长和图标尺寸在组件里，不在本页登记。
