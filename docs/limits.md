# 运行参数与限额

本页登记当前源码里的默认值和硬编码限额。调整时只改本页和对应源码；产品说明、Harness、架构、能力与边界、设计说明不重复这些数字。界面像素、颜色和动效以 `ray_agent/ui` 的样式与组件为准。背景里的窗口、模型和采样是当次实验条件，不随默认值改写。

配置文件是 [`ray_agent/api/config.yaml`](../ray_agent/api/config.yaml)。未写入的字段使用代码默认。部署用环境变量的名称见[运行指南](../ray_agent/README.md)。

## 模型与上下文

| 项 | 当前值 | 来源 |
|---|---|---|
| 默认协议 | `responses`；端点可显式改为 `chat_completions` | `app_config.py` 的 `LLMConfig.api_protocol` |
| 默认模型 | `deepseek-flash` | `config.yaml` |
| 应用默认窗口 / 输出上限 / 温度 | 200000 / 8192 / 0.7 | `config.yaml` 与 `LLMConfig`、`ModelSampling` |
| 请求超时 | 3600 秒。非流式是整次等待；流式是首个分片以及相邻分片的空闲间隔 | `LLMConfig.request_timeout` |
| DeepSeek 目录窗口 / 最大输出 | 1000000 / 393216 | `model_catalog.py` 的 `deepseek_models()` |
| DeepSeek 思考开启时的输出下限 | 32768 | 同上，`thinking_output_floor` |
| GPT 目录窗口 / 最大输出 | 200000 / 128000。应用配置再高也会封顶到目录窗口 | `model_catalog.py` 的 `_gpt_spec()` |
| GPT 思考输出下限 | 0 | 同上 |
| 安全余量 | 窗口的 5% | `AgentConfig.context_safety_ratio` |
| 可用输入 | 窗口 − 输出预留 − 安全余量。思考开启时，输出预留先抬到该模型的下限，再封顶到最大输出 | `budget.py`、`tuned_limits()` |

已知模型用 `model_profiles` 里的窗口、输出上限和温度，再封顶到目录。对话第一次运行记下当时的三项；之后改设置只影响新对话，对话里换模型则用目标模型当前的数值。

加载配置时，版本标记会把 DeepSeek 地址下仍为 131072 的全局窗口，以及 `deepseek-flash`、`deepseek-v4-pro` 里相同的旧窗口，迁到 200000 一次。已经改过的预算和会话里冻结的参数不迁移。来源是 `file_app_config_repository.py`。

## 请求预算、压缩与结果

| 项 | 当前值 | 来源 |
|---|---|---|
| 模型请求上限 | 100。从最近一条用户消息累计；重试和压缩摘要计入；补充消息与提问回复重新计算；审批续接沿用 | `AgentConfig.max_iterations` |
| 分阶段门槛 | 上限不小于 10 才分提醒和收尾 | `run_budget.py` 的 `MIN_PHASED_LIMIT` |
| 提醒 / 收尾 | 用到 70% 提醒一次；最后 10% 且至少 2 次进入收尾 | `REMIND_RATIO`、`FINALIZE_RATIO`、`MIN_FINALIZE_RESERVE` |
| 模型普通尝试 | 默认最多 3 次尝试（含首次），覆盖可重试传输错误、流中断和空回复；尝试间默认等待 1 秒 | `AgentConfig.max_retries`、`agent_loop.py` |
| 连接未建立的重试 | 最多再试 5 次，按 1、2、4、8、15 秒等待；不占普通尝试额度，但仍计入请求上限 | `agent_loop.py` 的 `_CONNECT_BACKOFF` |
| 模型 HTTP 连接池 | 最多 1000 个连接、100 个空闲连接，空闲保留 30 秒；Responses 完整终态后最多再读 1 秒尾部 | `openai_llm.py` |
| 手动压缩期限 | 服务端 60 秒，前端等待 70 秒 | `agent_service.py`、`api/session.ts` |
| 压缩水位 | 可用输入上限的 75% | `AgentConfig.compact_watermark` |
| 压缩保留轮数 | 3，保留区过大时减到 1 | `compact_keep_turns` |
| 重新注入的用户原文 | 16000 字符 | `compact_user_chars` |
| 单条工具结果 | 8000 字符，超出落盘并给首尾预览 | `tool_result_max_chars` |
| 独立读取并发 | 整批都是允许的独立读取时最多 3 项 | `tool_pipeline.py` 的 `read_batch()` |
| 同一核验再执行 | 已尝试不少于 2 次且仍未通过时，需说明新条件或换方法 | `task_outcomes.py` |
| 收尾补写 | 每项成功写入 1 次，或尝试达到 2 次后拒绝；单次内容最多 1000000 字符 | `finalize_artifact()` |
| 检索条数 | 10 | `AgentConfig.max_search_results` |

收尾只放行读取、交付、更新计划和受限文本补写。识别等待「不超过 15 秒、最多等一次」写在图片提示词 [`image_input.py`](../ray_agent/api/app/domain/services/prompts/image_input.py)，不是独立配置项。

## 沙箱与 Shell

| 项 | 当前值 | 来源 |
|---|---|---|
| 内存 / CPU / 进程数 | 2048 MiB / 2 / 512。环境变量 `SANDBOX_MEMORY_MB`、`SANDBOX_CPUS`、`SANDBOX_PIDS_LIMIT`；已有地址模式不套用 | `core/config.py` |
| 存活时间 | 60 分钟，`SANDBOX_TTL_MINUTES` 注入为沙箱的 `SERVER_TIMEOUT_MINUTES` | 同上 |
| 沙箱 HTTP 超时 | 600 秒 | `docker_sandbox.py` 的 `SANDBOX_HTTP_TIMEOUT_SECONDS` |
| 命令初次等待 | 5 秒，未结束则返回 running | `shell.py` 的 `EXEC_FOREGROUND_SECONDS` |
| 等待进程 | 未指定时 60 秒；上限 570 秒（HTTP 超时减 30 秒） | `shell.py`；`SHELL_WAIT_MAX_SECONDS` |
| 会话输出 | 1 MB（按字符计），超出保留尾部 | `OUTPUT_LIMIT_CHARS` |
| 进程组宽限 | SIGTERM 后 3 秒仍有进程则 SIGKILL | `PROCESS_GROUP_GRACE_SECONDS` |
| 停止后等待协程 | 10 秒 | `agent_task_runner.py` 的 `STOP_SETTLE_SECONDS` |

## 协议

| 项 | 当前值 | 来源 |
|---|---|---|
| MCP 连接 / 发现 / 调用 | 10 / 15 / 120 秒 | `ProtocolTimeouts` |
| MCP 全局发现预算 | 20 秒 | `MCPConfig.discovery_budget` |
| A2A 调用 / 取消 | 600 / 5 秒 | `A2A` 配置字段 |
| A2A 轮询间隔 | 从 1 秒增至 5 秒 | `a2a.py` |

## 公开网页读取

| 项 | 当前值 | 来源 |
|---|---|---|
| 传输及解压内容 | 各最多 2 MiB | 沙箱 `services/web.py` 的 `MAX_BYTES` |
| 重定向 | 最多 3 跳 | 同上，`MAX_REDIRECTS` |
| 单跳 HTTP / 全过程 | 8 秒 / 15 秒 | 同上 |

## 浏览器、截图与用户图片

| 项 | 当前值 | 来源 |
|---|---|---|
| 视口宽高 | 240–3840 | `playwright_browser.py`、`browser.py` |
| 页面观察默认 | 正文 6000 字符、元素 80 个；可调范围 200–20000 与 1–200 | `view_page()` |
| 单张截图 | 8 MiB、最长边 8192、1600 万像素 | `playwright_browser.py` |
| 视觉分析图 | 最长边 2048、2 MiB | 同上 |
| 每运行截图 | 8 次或 24 MiB；捕获与存储共 20 秒 | `agent_task_runner.py` |
| 临时图保留 | 24 小时，且运行已进入终态后才回收字节 | 同上，`86400` |
| 发往模型的图片 | 每请求最多 2 张；容量估算每张至少 1024 tokens | `vision.py`、`budget.py` |
| 用户原图 | 20 MiB、4000 万像素；PNG、JPEG、WebP、GIF 首帧 | `image_input.py` |
| 用户图输入副本 | 最长边 2048、2 MiB；每条消息最多 2 张进入像素输入 | 同上，`MAX_MESSAGE_IMAGES` |

## 预览、下载与项目文件

| 项 | 当前值 | 来源 |
|---|---|---|
| 文本分页 | 64 KiB | `file_preview.py` 的 `TEXT_PAGE_BYTES` |
| 表格窗口 | 200 行、50 列；行起点最高 100000 | `TABLE_PAGE_ROWS`、`TABLE_PAGE_COLUMNS`、`PreviewQuery` |
| 解析输入 / 工作簿解压 | 64 MiB / 128 MiB；工作簿条目超过 10000 个拒绝 | `PREVIEW_INPUT_BYTES`、`WORKBOOK_EXPANDED_BYTES`、`worker.py` |
| 预览位图像素 / 缩略图 | 约 3355 万像素（`32 * 1024 * 1024`）；缩略图最长边 1600 | `IMAGE_MAX_PIXELS`、`worker.py` |
| 解析进程 | 最多 3 个；墙钟 12 秒、CPU 10 秒；Linux 地址空间 768 MiB | `parser.py`、`worker.py` |
| 派生缓存 | 64 项或 32 MiB，保留 60 秒 | `parser.py` |
| 附件 ZIP | 1–100 个文件，实际总量 512 MiB | `file_service.py`、`file_routes.py` |
| 运行前快照 | 默认 5 份，允许 1–7 份 | `AgentConfig.project_snapshot_retention` |
| 项目上传 | 单文件 50 MiB，单次最多 2000 个文件或 200 MiB，项目总量 500 MiB | `core/config.py` |

预览不按单一文件大小整份禁用。超限时 CSV 可看已取得前缀，其他二进制降级为下载。原文件下载不受预览预算限制。

## 事件与界面轮询

| 项 | 当前值 | 来源 |
|---|---|---|
| 事件流兜底 | 有活动或刚有进展时 3 秒；连续空闲后 30 秒 | `agent_service.py` 的 `FALLBACK_POLL_SECONDS`、`IDLE_POLL_SECONDS` |
| 目录通知兜底 | 30 秒 | `catalog_notifier.py` 的 `CATALOG_FALLBACK_SECONDS` |
| 前端断线重连 | 500 毫秒起，每次翻倍，上限 4 秒 | `session-projection.ts` |
| 压缩状态轮询 | 进行中每 3 秒读一次会话详情 | `use-session-detail.ts` |
| 终端输出轮询 | 命令运行中每 1.5 秒 | `workbench.tsx` |

跟随底部的距离、缩略图边长和图标尺寸在组件里，不在本页登记。
