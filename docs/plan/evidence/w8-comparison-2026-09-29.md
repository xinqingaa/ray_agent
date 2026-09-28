# W8 综合验收与对比报告（2026-09-29）

本报告只记录这次实际跑过的次数与当场读到的结果，不外推成功率。机器可读的评测合并数据见 [w8-2026-09-29-0d9ea1f.md](w8-2026-09-29-0d9ea1f.md) 与同名 JSON。对照基线是 [w0-baseline-2026-09-28-961005d.md](w0-baseline-2026-09-28-961005d.md)（每条 1 次，任务只有 E1–E6）。

16 次评测按任务拆开跑。Docker 虚拟机内存约 8 GB，动态沙箱 `rayagent-sandbox-*` 积压会把内存占满（W7 的 E6 因此到 174.3 秒，E6-deny 正式轮读超时）。每个任务前后都删除这类动态容器，不删除 Compose 里的 `manus-sandbox` 等核心服务。

## 运行条件

| 项 | 值 |
|---|---|
| 分支 / HEAD | `phase-4` / `0d9ea1f`（完整 `0d9ea1f568a2b6007f5ab78bc1e4f567af4e42cb`） |
| 进入镜像的未提交代码 | API 五处清理：删除 `ContextOp` 对旧值 `compact` 的读取兼容，以及对应测试；从 `pyproject.toml`、`uv.lock`、`requirements.txt` 移除 `json-repair`。UI 与沙箱源码相对 HEAD 无差异 |
| 并行文档修改 | 写本报告时工作区还有其他文档与配图未提交。那些文件没有打进 API/UI 镜像 |
| 部署 | 在 `ray_agent/` 执行 `docker compose down -v` 后 `docker compose up -d --build`，再 `docker compose restart manus-nginx`。数据卷新建，库是空的 |
| 网关 | `http://localhost:8088`，API `http://localhost:8088/api` |
| 模型 | `deepseek-flash`，`https://api.deepseek.com/`，temperature 0.7，max_tokens 8192，context_window 65536。评测结束与本报告收尾时，公开配置读回仍是这组数值，且 `has_api_key` 为真。密钥未写入本报告 |
| Agent | max_iterations 100，max_retries 3，max_search_results 10，context_safety_ratio 0.05，compact_watermark 0.75，compact_keep_turns 3，compact_user_chars 16000，tool_result_max_chars 8000 |
| E7 临时窗口 | 该任务期间 context_window 24576、max_tokens 4096，两次结束后脚本都恢复为 65536 / 8192 |
| 工具策略 | 默认规则 `mcp:*` = ask、`a2a:*` = ask，未匹配为 allow。收尾时规则仍是这一组，MCP 与 A2A 服务器列表为空 |
| 评测时间 | 2026-09-29 02:53:52 至 02:58:37（各任务串行，中间含清容器） |
| 浏览器 | Playwright 无头，Chromium。生产界面走 `http://localhost:8088`。组件目录在生产构建返回 404，截图用本地 `npm run dev -p 3099` |

容器安装依赖的是 `requirements.txt`（由 `uv export --locked` 生成），不是 Dockerfile 里直接 `uv sync --locked`。重建后的 API 容器里 `importlib` 找不到 `json_repair`。把 `ContextEvent` 的 `op` 写成旧值 `compact` 会得到校验错误，不再当成 `strip_reasoning`。

## 代码清理与静态检查

| 命令 | 结果 |
|---|---|
| `ray_agent/api`：`uv run --locked python -m pytest` | 181 passed，9 skipped，2 warnings，1 error。错误是既有的 `tests/app/interfaces/endpoints/test_status_routes.py::test_get_status`：宿主机解析不到 `manus-postgres`。删除旧 `compact` 兼容测试后，相对 W7 的 182 passed 少 1 条，与删掉的那条测试一致。9 条跳过是未设置 `RAY_TEST_DATABASE_URI` |
| 临时 PostgreSQL 16（`ray-w8-pg`，端口 55436）上 `tests/core/test_run_events_pg.py` | 9 passed，7.84 s。跑完已 `docker rm` 该容器 |
| `ray_agent/sandbox`：`uv run --locked --python 3.12 python -m unittest discover -s tests -p 'test_*.py'` | Ran 2 tests，OK。日志里的 SIGTERM 后 SIGKILL 是该测试自己的终止路径 |
| UI：`npx tsc --noEmit` | 无输出，退出码 0 |
| UI：`npm run lint` | 0 error，22 warnings（既有：`markdown-content.tsx` 未使用的 node、`config.ts` 的 `_hasApiKey`、`fetch.ts` 的 options） |
| UI：`npm run build` | 成功。构建列出 `/dev/components`，生产运行时该页 `notFound` |
| UI：`node scripts/check-event-observability.cjs` | 全部 PASS（含审批、增量、速度）。脚本原有两条 LIMITATION：EOF 尾段、CRLF 分块 |
| API 容器内 `scripts/check_sandbox_environment.py` | 退出码 0。开头三次「无法确认 Sandbox Supervisor 进程状态: All connection attempts failed」，随后三项 JSON 通过：`reuse_and_separation`、运行身份 ubuntu、`explicit_cleanup`。检查创建的动态容器已销毁 |
| 部署后健康与策略 | postgres、redis、api、ui 为 healthy。nginx 无 healthcheck，状态为 Up。工具策略为上述默认规则 |

## 评测对照

必过检查在 16 次里都通过，指标与 `turn(completed)` 加 `compact` 的累加一致。`attempt` 事件 0 条，没有任何一轮的 `attempts` 大于 1。67 条带 `ttft_ms` 的已完成轮次里，首字延迟最小 245 ms、最大 1748 ms。下表「首字」是该次运行里这些轮次的最小到最大。

W0 的 E4 会话状态是 completed，必过检查失败：「停止后 5 秒内标记不再增长」（停止后 10 秒内行数从 9 增到 19）。W0 没有 E6-deny 和 E7。

| 任务 | 来源 | 终态（原因） | 耗时 s | 模型调用 | prompt / completion | 工具 | 必过检查 | 首字 ms |
|---|---|---|---|---|---|---|---|---|
| E1 | W0 | completed | 20.6 | 10 | 46323 / 1318 | 2（`message_notify_user`×2） | 通过 | — |
| E1 | 本次 1 `42679ccd-08fc-4122-8495-d1e804b14682` | completed | 10.0 | 2 | 8673 / 17 | 0 | 通过（第二轮回复「青松」） | 671–801 |
| E1 | 本次 2 `ffd90464-827a-4f5b-a7ae-a5480ce07d6c` | completed | 9.5 | 2 | 8673 / 41 | 0 | 通过 | 466–631 |
| E2 | W0 | completed | 27.7 | 16 | 95683 / 2575 | 10 | 通过 | — |
| E2 | 本次 1 `768c612f-f6a5-4df5-87ff-f5ba66e9df07` | completed | 13.2 | 5 | 24705 / 673 | 5 | 通过（total=60，源文件未改） | 406–904 |
| E2 | 本次 2 `aaf443d4-8801-4f32-9cd9-93bf43b30757` | completed | 11.7 | 4 | 19537 / 550 | 3 | 通过 | 450–519 |
| E3 | W0 | completed | 21.9 | 10 | 53291 / 1913 | 5 | 通过 | — |
| E3 | 本次 1 `c1dfc5ea-f7bc-4da3-ba19-d6307b599a0a` | completed | 11.0 | 4 | 18358 / 342 | 2 | 通过 | 273–730 |
| E3 | 本次 2 `1b49fced-e865-4962-94ab-3b5631534198` | completed | 12.1 | 4 | 18260 / 304 | 2 | 通过 | 608–1125 |
| E4 | W0 | completed（停止未写成 cancelled） | 32.5 | 3 | 12647 / 1015 | 1 | 未通过（标记继续增长） | — |
| E4 | 本次 1 `c6345083-8c40-47ed-937a-3a5838f46bc1` | cancelled（user_stop） | 29.1 | 3 | 14397 / 641 | 2 | 通过（停止后 10 秒标记停在 8 行） | 480–1591 |
| E4 | 本次 2 `0cf62213-d381-4d2b-b254-b25a8dcf03c2` | cancelled（user_stop） | 27.6 | 2 | 9026 / 307 | 1 | 通过（同样停在 8 行） | 604–834 |
| E5 | W0 | completed | 18.8 | 9 | 44206 / 1284 | 5 | 通过 | — |
| E5 | 本次 1 `6bf26772-e16f-4fc4-b8e9-b0e8daf2f94a` | completed | 13.8 | 5 | 23815 / 640 | 4 | 通过 | 521–1089 |
| E5 | 本次 2 `692c02e7-9184-4b58-9d10-08ec7cff7005` | completed | 13.1 | 5 | 23916 / 512 | 4 | 通过 | 426–824 |
| E6 | W0 | completed | 17.3 | 7 | 33068 / 1074 | 3 | 通过 | — |
| E6 | 本次 1 `f71f384e-2c20-4102-8dc1-65b1e719d5f2` | completed | 10.2 | 2 | 9699 / 155 | 1 | 通过（批准后 1234+5678=6912） | 647–694 |
| E6 | 本次 2 `807d0a85-a9ce-4d9c-b73d-46b38e2f0468` | completed | 9.7 | 2 | 9680 / 122 | 1 | 通过 | 533–539 |
| E6-deny | 本次 1 `259ba45d-d922-4617-b019-7872df70da6f` | completed | 11.8 | 3 | 14795 / 442 | 2 | 通过（拒绝后改用 shell，夹具未收到 add） | 245–1194 |
| E6-deny | 本次 2 `8fc3f9e6-f4d4-44af-81a2-ba907138d2b2` | completed | 11.2 | 3 | 14779 / 415 | 2 | 通过 | 306–1038 |
| E7 | 本次 1 `224a7b39-8fee-4bf1-b48d-e8f0f0e3327a` | completed | 52.2 | 14 | 126979 / 9706 | 17 | 通过（压缩 2 次，12 个校验码与 total=60） | 476–1748 |
| E7 | 本次 2 `908f0dc9-9553-4be2-b877-1d177e7f59bf` | completed | 30.3 | 12 | 92403 / 4785 | 17 | 通过（压缩 2 次） | 269–1410 |

重试：16 次运行都是 0。配置里的 `max_retries` 是 3，这次没有一次走到重试。

E7 两次压缩都是 watermark。第 1 次：估算 14775→5819（摘要 2 轮、保留 1 轮、重新注入 2 条），14844→10677（重新注入 3 条）。第 2 次：14703→5903、15487→6162。首次压缩之后模型继续读了后半材料（第 1 次 6 个 m07–m12，第 2 次这 6 个再加 source.csv）。源文件字节与上传一致。

### 和基线的差异，按这次看到的工具分布

- 规划循环和 `message_notify_user` 不在新版工具里。W0 的 E1 两次工具全是通知；本次 E1 工具为 0，模型调用 10→2，prompt tokens 46323→8673。E2、E3、E5、E6 的调用次数和 prompt tokens 同样下降，通知调用为 0。E2 第 2 次没有 `read_file` 仍通过交付检查，这是该次模型路径，不是检查放宽。
- 停止生效。E4 两次终态都是 cancelled / user_stop，停止后标记 10 秒内增长 0 行。W0 同检查失败，会话仍是 completed。两次耗时 29.1 s 与 27.6 s，相对 W0 的 32.5 s 只少几秒；模型调用 3 与 2，和基线的 3 接近。变的是终态和标记是否停住。
- E6 在默认 ask 下由评测脚本批准。两次都是 1 次 MCP 工具、约 10 秒。W0 同任务 17.3 秒、7 次模型调用、其中 2 次是通知。W7 在 21 个动态沙箱约占 7 GB 时该任务 174.3 秒；这次任务前后容器已清掉，不能把 10 秒和 174 秒的差全部算成产品改动。
- E6-deny 两次都通过，耗时 11.8 s 与 11.2 s。W0 无此任务。W7 正式轮在沙箱积压时读超时，清掉部分沙箱后的 `/tmp` 复跑是 14.9 s 且未入库。这次两次都进了正式报告。
- E7 在调低窗口后两次都完成，各压缩 2 次。W0 没有该任务，不能和基线比耗时。两次耗时 52.2 s 与 30.3 s，调用 14 与 12，都通过同一组检查。

## 跨包组合

脚本在产品界面操作，结论用页面文案和 API 读回核对。

| 项 | 结论 | 证据 |
|---|---|---|
| 流式生成中停止 | 通过 | 会话 `3ee85b1e-31c9-42d8-8a85-3dd4ebeb2637`，容器 `rayagent-sandbox-f73da1cc`。停止前页面上有正在增长的文本（约 136 字）且沙箱进程列表里有循环命令。停止后：状态「已停止」、`aria-busy` 文本消失、半截临时内容不留在时间线、进程列表里该循环不在、运行 `cancelled` / `user_stop`。截图 [w8-2026-09-29-stop.png](w8-2026-09-29-stop.png) |
| 触发压缩的长任务中途提问，回复后继续 | 通过（第二次脚本） | 窗口临时改为 24576 / 4096，结束后恢复。会话 `be4b10eb-e8b6-4c2c-8e07-ad40c457f36d`：压缩事件 2 条，提问卡「输出文件名用什么？」，回复后终态已完成，交付 `w8-out.json`。截图 [w8-2026-09-29-ask.png](w8-2026-09-29-ask.png)。第一次脚本失败见下文，那次没有形成有效的「中途提问」步骤 |
| 压缩后一轮的重建请求 | 通过 | 同一会话第 4 轮。开发者视图选中「第 4 轮」后，面板文本含 `[上下文摘要]`、`W8-KEEP-原文`、13 条消息，以及运行 ID 前 8 位。这些与 `GET /api/sessions/{id}/runs/{run_id}/turns/4/request` 一致。截图 [w8-2026-09-29-developer.png](w8-2026-09-29-developer.png) 视口停在 system 开头，摘要在面板滚动区域内，以脚本读到的全文和接口为准 |
| 等待审批时重启 API | 通过 | 会话 `430263ae-6fcb-43b2-8530-ec128deec4ab`。加法任务进入等待批准后 `docker compose restart manus-api`。页面「已中断」，原因「服务重启导致运行中断」；运行 `interrupted` / `api_restart`。截图 [w8-2026-09-29-restart.png](w8-2026-09-29-restart.png) |
| 运行中刷新 | 通过 | 会话 `aa36d6de-aeb3-4aaa-bd13-dbc8998e2104`。刷新前 `last_seq` 9，刷新后开发者事件表 9 条，序号不缺不重。截图 [w8-2026-09-29-refresh.png](w8-2026-09-29-refresh.png) |
| 运行中断网 8 秒再恢复 | 通过 | 同一会话。恢复后最大序号 16，相对刷新后的序列没有缺口、没有重复 |

## 既有能力回归

都从产品界面发起，各 1 次。

| 项 | 结论 | 证据 |
|---|---|---|
| 浏览器访问受控页面取事实 | 通过 | 宿主机页面校验码 `W8-BX-4418`。会话 `188de1c9-f184-4ac8-a8c0-5800040b0d30` 已完成，回复含该校验码，工具为打开网页、查看页面与 curl。截图 [w8-2026-09-29-browser.png](w8-2026-09-29-browser.png) |
| MCP 夹具 | 通过 | 夹具 `fixture_server.py`，服务名 `w8mcp`。会话 `c8414c0b-714d-459d-9f07-68135cc65278`：111+222，批准 1 次，回复 333。截图 [w8-2026-09-29-mcp.png](w8-2026-09-29-mcp.png) |
| A2A 夹具成功 | 通过 | `call_remote_agent` 默认需审批。会话 `84e068c9-0ae0-41ea-941f-fb446558b23e`：query `echo:w8-ping`，批准 1 次，回复含 `A2A_OK:w8-ping`。截图 [w8-2026-09-29-a2a-ok.png](w8-2026-09-29-a2a-ok.png) |
| A2A 夹具远端失败 | 通过 | 会话 `5915d18f-6079-4c3b-b2ff-d826e0520803`：query `fail`，批准 1 次，工具结果 success 为 false，文案 `A2A_EXPECTED_FAIL`。这次没有再用 Shell 把同一道题做成功。截图 [w8-2026-09-29-a2a-fail.png](w8-2026-09-29-a2a-fail.png) |

回归结束后脚本删掉了 `w8mcp` 和临时 A2A 服务器。收尾时两个列表都是空的。

## 界面走查

在最终代码对应的 Compose UI（HEAD 前端，本次没有改 UI 源码）上用 Playwright 重走。组件目录只在开发服务器可开，生产 `GET /dev/components` 返回 404。

| 要点 | 结论 | 证据 |
|---|---|---|
| 状态条、停止与终态 | 通过 | 停止走查见上。状态从执行工具到「已停止 / 你停止了这次运行」 |
| 计划条与工具卡 | 通过 | 会话 `5c51a01f-5d9d-44da-8595-e35f87458d58`：三步计划显示 3/3，工具卡为读取 `/etc/os-release` 等。截图 [w8-2026-09-29-workbench.png](w8-2026-09-29-workbench.png) |
| 工作台跟随 | 通过 | 同一会话：点工具后工作台固定，再点「回到最新」变为正在跟随。交付文件 `w8-host.txt` 出现在工作台 |
| 提问 | 通过 | 压缩任务中的提问卡，见跨包一节 |
| 交付下载 | 通过 | 上传 `source.csv` 后交付 `summary.json`，下载内容含 60。截图 [w8-2026-09-29-delivery.png](w8-2026-09-29-delivery.png) |
| 开发者视图 | 通过 | 事件表序号连续；压缩后第 4 轮重建请求与调试接口一致 |
| 审批卡 | 通过 | MCP、A2A 两次批准，以及等待批准时重启后的「已失效」 |
| 暗色 | 通过 | 同一完成会话切到深色，`html` 带 `dark`。截图 [w8-2026-09-29-dark.png](w8-2026-09-29-dark.png) |
| 390×844 | 通过 | 新页面打开同一 URL，状态条换行，计划 3/3 与交付仍在，`scrollWidth` 未超出视口。截图 [w8-2026-09-29-narrow.png](w8-2026-09-29-narrow.png) |
| 组件状态目录 | 通过（第三次） | `http://127.0.0.1:3099/dev/components`。74 条 `figcaption`，子计划状态名单去掉「真实/合成」后没有缺失。浅色截图含空闲、模型思考中、工具执行中、等待回复、等待审批、停止中、已完成。深色截图含待审批、提交中、已批准、已拒绝、已失效。截图 [w8-2026-09-29-catalog-light.png](w8-2026-09-29-catalog-light.png)、[w8-2026-09-29-catalog-dark.png](w8-2026-09-29-catalog-dark.png) |

按 `skills/frontend-design`：这次走查看到的是同一套专业工具界面（状态条、计划、工具卡、工作台、审批卡），亮暗与窄屏没有各画一套。没有发现需要改组件才能看的视觉断裂，因此没有为视觉再改代码。

设置页四个分区的保存、校验和错误提示这次没有逐项操作。W5 验收原文有这项，本次任务列出的走查要点没有单列它。

## Web Interface Guidelines 审查

对照 Vercel web-interface-guidelines 的清单，在现有源码和这次页面上核对。没有改 UI。严重项：没有。下面是逐项结论；未改代码的都记在这里。

| 项 | 结论 |
|---|---|
| 可访问性名称 | 上传、发送、移除附件使用 `aria-label`。主输入 `textarea`（`chat-input.tsx` 约 206–215 行）只有 placeholder「描述一个任务，或从下面接着最近的会话」，没有 label 或 `aria-label` |
| 焦点 | 按钮使用 `outline-none` 并配 `focus-visible:ring`。主输入框是 `outline-none`，没有替代的焦点环 |
| 键盘与语义 | `html lang="zh-CN"`。主题菜单是 `menuitemradio`。未发现禁用缩放 |
| 表单 | 设置页输入有 placeholder。本次没有逐项提交设置表单，不对其校验文案下结论 |
| 动效 | `button.tsx`、`switch.tsx`、`sidebar.tsx` 使用 `transition-all`（组件库默认）。`globals.css` 有 `prefers-reduced-motion: reduce` |
| 深色 | `globals.css` 分亮暗设置 `color-scheme`。目录页与完成会话都切到深色并截图 |
| 对比度抽样 | 目录页浅色：标题约 16:1，说明文字最低约 5.75:1。深色抽样约 9.13:1 到 17.24:1。抽样没有低于 4.5:1 的正文。没有做全页自动审计 |
| 命中区域与图标按钮 | 走查里的停止、发送、批准、拒绝可点。图标按钮抽查有名称 |
| 长列表 | 时间线与开发者事件表没有虚拟化（W5 实施修正已写明）。这次刷新表到序号 16、压缩会话事件更多，页面仍可操作，没有观察到卡死 |
| 日期 | 会话时间用「今天 / 昨天 / 星期」手工计算（`formatDayLabel`），不是 `Intl`。中文界面可读 |
| 跳过链接与 theme-color | 根布局没有 skip link，没有 `theme-color` |
| 生产目录页 | `/dev/components` 在生产构建返回 404，只在 `npm run dev` 可开。这是现有 `NODE_ENV === "production"` 分支，不是这次回归 |

## 失败与修复

没有为了让评测通过而改任务或改产品行为。产品代码改动只有验收开始时要求的两处清理。

1. 压缩组合脚本第一次失败。会话 `dce33ec9-3387-42b6-9432-f3aeb2e87aa4` 实际是 completed、`last_seq` 134、3 次运行、压缩 5 次、没有提问等待。原因是脚本把上一轮残留的「已完成」当成新一轮已经结束，把后续提示灌进同一次运行，并且按扁平字段读 `{event, data}` 事件，于是报「没有可选轮次」。这不是产品没压缩。脚本改为按运行条数增加且进入终态或 waiting 再发下一句，提问文案指定 `message_ask_user`，事件改读 `data`。第二次（会话 `be4b10eb-…`）通过。
2. 组件目录第一次：开发服务器还在编译，`goto` 得到 `ERR_EMPTY_RESPONSE`，空白图不能当证据。第二次：`.next/dev/lock` 被已经在跑的 `next dev --port 3000` 占用，90 秒内 3099 没有 HTTP 200。结束该进程并删掉锁之后，第三次打开目录页，74 个状态齐全，浅色与深色截图有效。验收结束时 3099 上的开发服务器已停。端口 3000 上那个进程没有重新拉起。
3. 全量 pytest 的 `test_status_routes` 错误是既有项（宿主机没有 `manus-postgres` 这个主机名）。没有改这个测试。
4. 沙箱环境检查开头三次连不上 Supervisor，随后三项通过、退出码 0。记为启动瞬间未就绪后的重试，不记为失败。
5. 第一次批量删除动态沙箱时有容器留在 `manus-network` 上。再次按名称 `docker rm -f` 后清掉。收尾时这类容器数量为 0。

## 收尾时的服务

动态沙箱已删除。核心 Compose 仍在运行：`manus-postgres`、`manus-redis`、`manus-api`、`manus-ui` 为 healthy；`manus-sandbox` 与 `manus-nginx` 为 Up。API 在审批重启项里重启过，走查发生在那次重启之后。模型窗口与默认工具策略已恢复，MCP / A2A 列表为空。临时 PostgreSQL 与目录页开发服务器已停。

截图共 15 张，前缀 `w8-2026-09-29-`：`stop`、`refresh`、`ask`、`developer`、`browser`、`mcp`、`a2a-ok`、`a2a-fail`、`restart`、`delivery`、`workbench`、`dark`、`narrow`、`catalog-light`、`catalog-dark`。
