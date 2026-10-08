# W7：执行控制与安全边界

所属：[二次开发总计划](README.md)。规模：中，1 个对话。三个子项的前置不同：

| 子项 | 内容 | 前置 |
|---|---|---|
| W7.1 | Shell 执行修复与进程组收尾 | 无，W0 之后随时可做 |
| W7.2 | 工具级审批 | W1（工具管线）、W3（等待状态）、W5（审批卡与设置页分区） |
| W7.3 | 沙箱执行身份与资源限制 | 无；与 W2 的输出落盘目录协调 |

## 目标与不做

**目标：** 长命令和后台进程按设计返回运行中状态；停止与终止能结束整棵进程树；高风险工具调用前可以要求用户批准；沙箱以普通用户运行并有基本资源上限。

**不做：** 自动分析 Shell 命令语义、网络出站过滤、多租户隔离、交互式接管浏览器、浏览器按需启动、通用策略平台。

## 现状

以下是实施前的代码快照。行号在 W2 给 Shell 输出加了上限之后已经移动；当前行为见文末“实施修正”。

- 沙箱 `exec_command` 创建子进程后直接 `await` 输出读取协程（[`sandbox/app/services/shell.py`](../../ray_agent/sandbox/app/services/shell.py)）。读取协程要到输出结束才返回，推断会让接口阻塞到进程退出，后面的 5 秒等待因此失效；与 2026-09-09 观察到 `sleep 6` 约 6 秒后返回 completed 一致（见[背景](../background/README.md#工作区调研的本地观察)）。该推断尚未经 Docker/HTTP 实测。
- API 调用沙箱的 HTTP 客户端超时为 600 秒（[`docker_sandbox.py`](../../ray_agent/api/app/infrastructure/external/sandbox/docker_sandbox.py) 第 39 行）；W1 之前工具异常会重试 3 次，长命令可能被重复执行。
- 子进程用 `create_subprocess_shell` 启动，终止只作用于 bash 进程本身（shell.py 第 60–76、368–404 行），命令派生的子进程可能留下。
- 沙箱 FastAPI 以 root 运行（[`supervisord.conf`](../../ray_agent/sandbox/supervisord.conf) 第 26–38 行）；镜像创建了带免密 sudo 的 ubuntu 用户（[`Dockerfile`](../../ray_agent/sandbox/Dockerfile) 第 20–22 行）。
- 创建容器时没有 CPU、内存、进程数限制；API 注入 `SERVICE_TIMEOUT_MINUTES`，沙箱读取 `server_timeout_minutes`（docker_sandbox.py 第 122–134 行；[`sandbox/app/core/config.py`](../../ray_agent/sandbox/app/core/config.py) 第 16 行）。
- 敏感操作前确认只写在提示词里，工具分发前没有策略检查。

## 设计

### W7.1 Shell 执行与进程组

- 输出读取协程用 `asyncio.create_task` 启动后不等待，任务引用保存在 `ShellService._output_tasks`，进程结束或被替换前再等待读取收尾；`exec_command` 等待进程最多 5 秒，未结束返回 `running`，已结束返回完整输出。
- 子进程以新会话启动（`start_new_session=True`），终止时对进程组先发 SIGTERM，有界等待（默认 3 秒）后若组内仍有存活进程则发 SIGKILL，返回实际退出码。等待的是整组退出，而不是只等外壳进程：外壳可能被 SIGTERM 立刻杀死，忽略该信号的子进程还在。同一 Shell 会话执行新命令前终止旧进程时也按进程组处理。外壳已经退出后不再按进程组号补杀，避免编号被系统复用后误伤。
- W3 的停止传播调用的就是这个终止接口；本项完成后，E4 的“停止后标记不再增长”才有意义。
- API 侧 Shell 工具的等待超时与 HTTP 超时对齐：`DockerSandbox.wait_process` 把等待秒数截断到 570（HTTP 超时 600 减去余量 30）。未传或非正数仍由沙箱按默认 60 秒处理。

### W7.2 工具级审批

- 配置：应用配置 `tool_policy.rules` 是一张“规则键 → `allow` / `ask` / `deny`”的表。规则键：内置工具写函数名（如 `shell_execute`）或 `<工具集>:*`（如 `shell:*`）；MCP 写 `mcp:<服务名>:<服务端工具名>`、`mcp:<服务名>:*`、`mcp:*`；A2A 写 `a2a:<远程 Agent id>:call_remote_agent`、`a2a:<id>:*`、`a2a:*`。越具体的键优先，未匹配任何规则为 `allow`。默认规则只有 `mcp:*` 与 `a2a:*` 两条 ask，沙箱内的文件、Shell、浏览器、检索与交付未列出即 allow。计划与提问（`update_plan`、`message_ask_user`）不受策略约束，写进规则表会被拒绝；A2A 的 `get_remote_agent_cards` 只读本地缓存，不在 `a2a:*` 范围内。设置接口 `GET/POST /app-config/tool-policy` 读写整表，编辑入口在 W5 设置页预留的“工具策略”分区实现。
- 分发前检查：作为 W1 工具管线执行前段的处理函数，排在参数校验之后。`deny` 短路为“策略禁止”的失败结果，不执行；`ask` 时发出 `approval(pending)` 事件，本轮以 turn(completed) 收尾，运行进入 waiting（原因 `approval`），退出协程。同一批次中该调用之后的调用不执行。
- 回复：`POST /sessions/{id}/approvals/{tool_call_id}`，body 为 `{"decision": "approve" | "deny"}`。接口在同一事务里把运行改回 running 并写入 `approval(approved / rejected)`，再由新任务续接：批准时执行该调用一次并回填结果；拒绝时回填“用户拒绝执行”，调用不执行，结束事件带 `denied_by: "user"`。两种情况下，同一批次后续未执行的调用都按 W1 的悬空调用规则补为未执行，然后请求模型。批准只对这一个调用有效，只跳过 ask，续接时 deny 仍然生效。
- 等待审批时 API 重启：启动扫描把该运行置为 interrupted（原因 `api_restart`），写入 `approval(expired)`，待审批的调用与同批后续调用补为未执行；用户需要重新发起任务。这与等待提问时重启可以续接不同，原因是批准针对的是重启前的执行环境。
- 重复回复或回复已结束的审批返回冲突错误（409），不重复执行。等待审批时聊天接口也返回 409：先批准、拒绝或停止。
- 界面：W4 视图模型的 `approval` 条目与 `waiting_approval` 动作接入审批事件；W5 的审批卡接入批准与拒绝接口，覆盖其全部状态。

### W7.3 执行身份与资源限制

- Supervisor 管理的服务进程改为 ubuntu 用户运行，FastAPI 的 `HOME` 与工作目录为 `/home/ubuntu`；需要 root 的操作通过免密 sudo 完成，与提示词描述一致。容器入口 supervisord 仍是 root。虚拟显示增加 `Xvfb -ac`，使 ubuntu 进程能连接显示。上传目录与 W2 的输出落盘目录在第一次写入时由该用户创建，路径仍是 `/home/ubuntu/upload` 与 `/home/ubuntu/.rayagent/outputs`。
- 容器创建时设置内存、CPU 与进程数上限，默认值写入 API 配置并可调整：2048 MiB、2 CPU、512 个进程。内存上限同时把 swap 限制设为同一值，避免 Docker 默认的双倍 swap 把帽子放大。环境变量为 `SANDBOX_MEMORY_MB`、`SANDBOX_CPUS`、`SANDBOX_PIDS_LIMIT`。已有沙箱地址模式不创建容器，不套用这些限额。
- TTL 环境变量统一为沙箱读取的 `SERVER_TIMEOUT_MINUTES`。API 侧仍是 `SANDBOX_TTL_MINUTES` / `sandbox_ttl_minutes`，创建容器时按这个值注入。
- 提示词中的环境描述按修改后的镜像更新（执行身份 ubuntu、免密 sudo、Python 3.10、Node.js 24、工作目录 `/home/ubuntu`）。

## 改动清单

- 沙箱：`services/shell.py`、`supervisord.conf`、必要时 `Dockerfile`；
- API：`docker_sandbox.py`（限额、TTL 变量名）、`core/config.py`（限额配置）、Shell 工具超时参数；
- API 领域层：工具策略模型与管线执行前处理、审批请求事件、审批回复处理；
- 应用服务与路由：审批接口；启动扫描覆盖待审批运行；
- 前端：视图模型的审批条目、审批卡接入、设置页工具策略分区；
- 提示词：环境描述；
- 测试与脚本：[`scripts/check_sandbox_environment.py`](../../ray_agent/api/scripts/check_sandbox_environment.py) 增加执行身份、限额与 TTL 检查。

## 验收

**自动测试：**

1. 沙箱 ShellService：`sleep 10` 在约 5 秒内返回 running；`sleep 1 && echo ok` 返回 completed 与输出；
2. 进程组：命令派生后台子进程且忽略 SIGTERM，终止后整组进程都已退出；
3. 审批（ScriptedLLM）：ask 进入 waiting；批准执行一次；拒绝不执行且回填拒绝结果；批次后续调用补为未执行；重复回复返回冲突；deny 不执行；
4. 等待审批时启动扫描：运行变为 interrupted，调用补为未执行。

**实际环境：**

- 用检查脚本确认容器内服务进程的用户为 ubuntu，限额与 TTL 生效；
- 评测 E4：停止后在沙箱内查看进程列表，脚本进程已退出，标记在 5 秒内不再增长；
- 评测 E6：MCP 调用出现审批卡片，批准后得到正确结果；另跑一次拒绝，Agent 收到拒绝并给出说明；
- 复跑 E1–E5，确认无回退。

## docs 同步

- [Harness 工程](../harness.md)：工具契约层的“授权”环节；
- [架构说明](../architecture.md)：沙箱生命周期与限制、控制参数表；
- [能力与边界](../capabilities.md)：动作授权、沙箱配额与权限、已知不一致中的 TTL 与执行身份两条；
- [沙箱开发指南](../../ray_agent/sandbox/README.md)、[运行指南](../../ray_agent/README.md)：执行身份、限额配置；
- [产品说明](../product.md)：审批交互与停止效果；
- [代码地图](../code-map.md)：执行环境、工具与动作分组。

## 交接

给 W8（W7.2，2026-09-29，代码基线 `b2d83c5` 加阶段 B 未提交改动）：

- **完成范围：** 阶段 A（后端与评测脚本，提交 `72a5c23`）与阶段 B（前端接入、容器重建、评测、真实浏览器走查、docs 同步）。下面“阶段 A 交给阶段 B”的事件与接口约定仍是当前契约，前端按它实现。
- **前端契约：** 投影从 `approval` 事件构造审批条目，结论原地更新；批准后同一调用的 `tool` 事件写回该条目，不另起工具组；`expired` 时调用状态为 `skipped`（未执行）；审批挂起时的 `wait` 不生成提问条目。`denied_by` 让调用状态为 `denied`，文案分用户拒绝与策略禁止。等待审批时输入框禁用，侧栏徽标为「等你处理」（会话列表接口不带等待原因，提问与审批共用）。设置页工具策略分区整表保存，内置工具集选“直接执行”即删除该键，服务器行可选“跟随”。
- **终端实时输出：** W5 起 `ViewShellParams` 的字段一直写成 `shell_session_id`，接口要求 `session_id`，实时读取每次都返回 422，只有调用结束后的结果能显示；已改正，并在 `online` 时立即重读、失败时保留上次输出。W6 走查记录的「恢复后仍显示网络连接失败」根因在此。
- **评测：** Git 提交 `2e68aa3` 中的 `w7-2026-09-29-b2d83c5`，E1–E6 与 E6-deny 各 1 次，对照 W2。E1–E5 通过，指标与 W2 同量级；E6 通过但耗时 174.3 秒（W2 为 10.3 秒），E6-deny 在该报告里“运行出错（ReadTimeout）”。两者发生时 Docker 虚拟机里积压了 21 个动态沙箱（约 7 GB，虚拟机共约 8 GB），API 日志里创建会话用了 72 秒；清掉 15 个 15 分钟以上的空闲沙箱后，E6-deny 单任务复跑 14.9 秒通过（报告写在 `/tmp`，未入库）。W8 综合验收需要在沙箱不积压的环境下重跑 E6 以取得可比耗时。
- **走查：** Playwright 无头脚本（`/tmp/w5-pw/w7.mjs`，未入库）驱动 `http://localhost:8088`，MCP 夹具按 E6 的方式配置，结束后恢复。批准、拒绝、刷新恢复、等待审批时停止、等待审批时重启 API、设置页读写工具策略、断网恢复后终端错误清除均通过。当次 8 张截图在 Git 提交 `2e68aa3`，当前证据目录不再保留。
- **未覆盖：** A2A 调用的审批只有本地测试；策略禁止与内置工具 ask 没有浏览器走查；设置页的添加与删除其他规则、恢复默认、保存失败提示没有浏览器操作；等待审批时同时打开两个页面的并发答复只有接口层 409 的测试；E6 的可比耗时见上。W8 的跨包检查“等待审批时重启 API”本次已走查一遍，可在最终代码上复查。

阶段 A 交给阶段 B 的事件与接口约定（2026-09-29，代码基线 `33964e0` 加当时未提交改动）：

- **审批事件：** SSE 与 `GET /sessions/{id}` 的事件类型为 `approval`，同一调用按时间可能有 pending 与一条结论事件，结论为 `approved` / `rejected` / `expired`，各有自己的 `event_id` 与 `seq`。pending 示例：

  ```json
  {"event": "approval", "data": {
    "event_id": "ad51…", "seq": 8, "run_id": "ae17…", "created_at": 1790618566325,
    "tool_call_id": "call_0", "name": "mcp", "function": "mcp_w0eval_add_3f2a…",
    "args": {"a": 1234, "b": 5678}, "status": "pending",
    "rule": "mcp:w0eval:*", "service": "w0eval", "service_tool": "add", "decided_at": null}}
  ```

  `name` / `function` / `args` 与工具事件同名同义，`function` 对 MCP 是哈希别名，展示用 `service` 加 `service_tool`。A2A 的 `service` 是远程 Agent id，`service_tool` 为 `call_remote_agent`，内置工具两项为空。`rule` 是命中的规则键。结论事件复制请求字段，`decided_at` 为毫秒时间戳。
- **事件顺序：** 等待时为 `turn(started)` … `approval(pending)` → `turn(completed)` → `wait` → `run(waiting, reason=approval)`，挂起的调用没有 `tool` 事件，所以界面要从审批事件本身构造调用条目，不能要求已有同 ID 的工具事件。批准后为 `run(running)` → `approval(approved)` → `tool(calling)` → `tool(called)` → `turn(started, index=N+1)`。拒绝后为 `run(running)` → `approval(rejected)` → `tool(called, denied_by="user")` → 下一轮。续接执行的这次调用落在两轮之间，不在任何 turn 的 `tool_call_ids` 里。策略禁止的调用只有 `tool(called, denied_by="policy")`，没有审批事件。`denied_by` 只出现在 called 上，有值时 `content` 为空。
- **何时显示审批卡：** `run.status == "waiting"` 且 `reason == "approval"` 时，待审批的调用是该运行最新一条仍为 pending 的审批事件。此时聊天接口返回 409，输入框应改为引导批准、拒绝或停止。停止返回 `cancelled/user_stop` 并写入 `approval(expired)`。
- **审批接口：** `POST /sessions/{session_id}/approvals/{tool_call_id}`，body `{"decision": "approve" | "deny"}`。成功时 `code` 为 200，`msg` 为“审批已受理”，`data` 为 `{"run_id", "seq", "status": "approved" | "rejected"}`，其中 `seq` 是结论事件的序号，续接过程从事件流观察。错误：会话或该调用的审批请求不存在返回 404。审批已回复、已失效，或运行不在等待这次审批时返回 409，响应带 `code` 与 `msg`，不重复执行。`decision` 取值非法由 FastAPI 返回 422（`{"detail": [...]}`，不是统一响应结构）。
- **设置接口：** `GET /app-config/tool-policy` 返回 `{"rules": {...}, "default_rules": {"mcp:*": "ask", "a2a:*": "ask"}, "fallback": "allow", "builtin_toolsets": [{"toolset": "file", "functions": ["read_file", …]}, …]}`。`builtin_toolsets` 列出内置工具集（file、shell、browser、search、deliver，以及 a2a 的 `get_remote_agent_cards`），不含计划与提问。MCP 服务名与原始工具名取 `GET /app-config/mcp-servers` 的 `server_name`、`tools`，A2A id 取 `GET /app-config/a2a-servers`。`POST /app-config/tool-policy` 的 body 为 `{"rules": {...}}`，整表替换，返回同一结构。键格式不对、指向豁免工具或出现多余字段返回 400 或 422。修改从下一次创建的执行任务起生效，包括新运行和审批、提问续接。
- **评测：** `scripts.eval` 已支持 `TaskSpec.on_approval = DecideOnApproval([...])`。运行因审批进入 waiting 时按顺序答复，用完后停在等待审批并不再发送后续轮次。E6 的环境把规则表临时设为 `mcp:w0eval:*` = ask（清除该服务更具体的键），结束后恢复原表，答复 approve，新增必需检查“add 调用先请求审批、再按答复执行”。新增 `E6-deny` 使用同一夹具，答复 deny，必需检查包括：审批状态为 pending → rejected、add 结束事件都是 `denied_by=user`、夹具没收到 add 调用、运行正常结束；最终回复只记录。运行方式与 E6 相同（`--tasks E6,E6-deny`）。阶段 A 未运行评测。
- **未覆盖（阶段 A 当时）：** 前端全部接入、容器内实际运行、E6/E6-deny 实跑、E1–E5 复跑、真实浏览器走查、docs 同步；已由阶段 B 完成，见上。

给 W8（W7.1、W7.3，2026-09-28）：

- **停止与进程组：** W3 的 `stop_processes` 仍调用沙箱 `kill_process`，最多等 10 秒，结果写入 `cleanup`。终止打到进程组：SIGTERM，约 3 秒后组内仍有非僵尸进程则 SIGKILL。外壳已经退出后不再 `killpg`。同一 Shell 会话执行新命令前也按组终止。E4 的前台 `sleep` 循环会响应 SIGTERM，因此日志是返回码 -15，没有走到 SIGKILL；忽略 SIGTERM 的子进程由沙箱 `tests/test_shell_service.py` 覆盖。
- **Shell 初次返回：** `exec_command` 最多等 5 秒。未结束时沙箱记一条等待超时（`BadRequestException`），接口返回 `running`，读取协程继续跑。API 侧 `DockerSandbox.wait_process` 把等待秒数截断到 570（HTTP 读超时 600 减去余量 30）。未传或非正数仍由沙箱按默认 60 秒处理。截断只在适配层，工具层不重复。
- **执行身份：** Supervisor 管理的服务（FastAPI、Chromium、Xvfb、x11vnc、socat、websockify）以 `ubuntu` 运行，`HOME` 与工作目录 `/home/ubuntu`。supervisord 主进程仍是 root。`Xvfb -ac`。上传目录与 `/home/ubuntu/.rayagent/outputs` 第一次写入时创建，路径未改。W2 交接里“当前以 root 运行”已被本包取代。
- **限额与 TTL：** 动态创建时 `mem_limit` 与 `memswap_limit` 同为 `SANDBOX_MEMORY_MB`（默认 2048）MiB，`nano_cpus` 为 `SANDBOX_CPUS`（默认 2）×10⁹，`pids_limit` 为 `SANDBOX_PIDS_LIMIT`（默认 512）。`SANDBOX_ADDRESS` 已设置时不创建容器，不套用限额。`SANDBOX_TTL_MINUTES`（默认 60）注入为沙箱读取的 `SERVER_TIMEOUT_MINUTES`，不再注入 `SERVICE_TIMEOUT_MINUTES`。多数 `/api` 请求会把剩余销毁时间延长 3 分钟，所以检查到的剩余时间可以大于 60 分钟。
- **检查脚本：** 在 API 容器内执行 `python scripts/check_sandbox_environment.py`（宿主机 `uv run` 读的是 `api/.env`，不一定与 Compose 一致）。2026-09-28 通过：用户 ubuntu、uid 1000、HOME 与工作目录 `/home/ubuntu`、Python 3.10.12、Node v24.21.0；上述服务进程用户均为 ubuntu；上传目录与输出目录属主 ubuntu；内存与 swap 2147483648、NanoCpus 2000000000、PidsLimit 512；`SERVER_TIMEOUT_MINUTES=60` 且没有 `SERVICE_TIMEOUT_MINUTES`；超时计时活动，剩余约 5400 秒。
- **评测：** Git 提交 `2e68aa3` 中的 `w7-1-3-2026-09-28-4b413ef`，只跑 E2、E4 各 1 次，对照 W2。E2 通过（`total` 60，source.csv 未改）。E4 通过：停止后标记停在 8 行，10 秒内不增长；`cleanup` 为 `shell e4 success=True`。停止后 `docker exec` 进 `rayagent-sandbox-fbda657d`：进程列表里没有该循环，标记文件 8 行、属主 ubuntu，再等 5 秒仍是 8 行；该容器 HostConfig 与默认限额一致。E1–E5 全量与 E6 留到 W7.2 完成时。
- **未覆盖：** 审批；TTL 真正到期；API 崩溃后沙箱进程回收；网络出站过滤；工作目录不是访问围栏；地址模式不限额；supervisord 仍是 root。沙箱单测不在容器里跑，不证明执行身份。

## 实施修正（W7.1、W7.3）

实施中以代码为准修正了本文以下内容：

1. “现状”改为实施前快照。W2 给 Shell 输出加了约 1 MB 上限之后，文中的行号不再指向当前源码。
2. 输出读取协程的任务引用放在 `ShellService._output_tasks`。同一会话执行新命令前，先收尾旧的读取任务，再清空该会话的输出，避免旧字节写进下一条命令。5 秒到点时沙箱抛出 `BadRequestException`（日志“Shell会话进程等待超时”），接口返回 `running`，不取消读取协程。
3. 进程组等待的是整组里是否还有非僵尸进程，而不是只等外壳。外壳退出且返回码已经记下之后，不再按进程组号补杀，避免编号被系统复用后误伤。同一会话换命令时也走这条路径。
4. 等待秒数的截断只放在 `DockerSandbox.wait_process`（570 = 600 − 30）。Shell 工具不再各自封顶。`None` 和非正数原样传给沙箱，由沙箱按默认 60 秒处理。
5. 改为 ubuntu 的不只是 FastAPI：`supervisord.conf` 里的 chrome、socat、xvfb、x11vnc、websockify 都设置了 `user=ubuntu`。supervisord 本身仍是 root。`Xvfb` 增加 `-ac`，否则 ubuntu 连不上显示。没有在 Dockerfile 里预建上传目录和输出目录，第一次写入时由 ubuntu 的文件服务创建，这样镜像构建可以继续用缓存。路径仍是 `/home/ubuntu/upload` 与 `/home/ubuntu/.rayagent/outputs`。
6. 内存上限同时设置 `memswap_limit`，与 `mem_limit` 相同，避免 Docker 默认允许双倍 swap。环境变量名为 `SANDBOX_MEMORY_MB`、`SANDBOX_CPUS`、`SANDBOX_PIDS_LIMIT`。已有沙箱地址模式不套用。
7. TTL 注入名改为沙箱 `Settings` 读取的 `SERVER_TIMEOUT_MINUTES`。原先注入的 `SERVICE_TIMEOUT_MINUTES` 沙箱不读，改 `SANDBOX_TTL_MINUTES` 不会生效。
8. 中英文系统提示词按当前镜像改写：命令以 ubuntu 执行、免密 sudo、工作目录与 `HOME` 为 `/home/ubuntu`、Python 3.10、Node.js 24。输出落盘路径没有改。
9. 检查脚本第一次把 `stat` 的返回值写进变量 `owned`，盖掉了待回收的容器列表。`ToolResult` 可迭代，`finally` 里对元组调用 `destroy` 失败，把已经通过的检查盖掉，并留下两个动态容器。已改名为 `owner_result`。第二次在 API 容器内执行通过。
10. 沙箱测试用 `unittest`，不新增 pytest。指南中的命令是 `uv run --locked`（项目要求 Python 3.10）。本环境下载 CPython 3.10 没有进展，实际用已缓存的 3.12 跑通两项验收。这些测试不启动容器，不证明执行身份与限额。

## 实施修正（W7.2）

阶段 A（后端、评测脚本代码与自动测试）实施中以代码为准修正了上文“W7.2 工具级审批”，要点如下：

1. **规则键：** MCP 工具在循环里的名字是哈希别名，策略按 MCP 客户端的路由表还原为“服务名 + 服务端原始工具名”再匹配；路由表里找不到时只匹配 `mcp:*`。A2A 以 `call_remote_agent` 参数里的远程 Agent id 为服务名。内置工具的键是函数名或 `<工具集>:*`，不支持 `file:read_file` 这类写法。原文“默认沙箱内工具为 allow”在实现上表现为不列规则，由兜底 allow 生效。
2. **豁免与校验：** 计划与提问工具不受策略约束，否则 ask 会让提问本身停下来等审批。规则表在配置模型上校验：空键、不认识的 `x:y` 写法、`mcp:<服务名>` 缺工具段、指向豁免工具都会被拒绝。设置接口整表替换，不做逐条增删。
3. **审批状态独立成事件：** 审批用单独的 `approval` 事件记录（pending 与一条结论），不给工具事件加状态。原因是挂起时调用还没有进入执行，写 `tool(calling)` 会破坏 calling / called 成对的约定。结论由写入它的一方在状态迁移的同一事务里写入：审批接口写 approved / rejected，停止、启动扫描与消息竞态写 expired。
4. **挂起不另开状态：** 工具管线的执行前处理设置 `suspend_event` 表示挂起，管线产出该事件后不执行、不发 called。循环收尾本轮再发 wait，任务层按原因 `approval` 迁移到 waiting。续接由循环的 `resume_approval` 完成：批准或拒绝的调用重新经过管线（带审批标记，只跳过 ask），再按悬空规则补同批剩余调用，然后回到主循环，轮次编号接续。
5. **补结果文案：** 同批后续调用补为“未执行：同一批次中前面的调用在等待用户审批……”。用户拒绝回填“用户拒绝执行：该调用未执行……”，结束事件带 `denied_by: "user"`。策略禁止回填以“策略禁止：”开头的说明，结束事件带 `denied_by: "policy"`，不产生审批事件。
6. **停止与重启时立即修复记忆：** 等待审批时停止（cancelled）或 API 重启（interrupted）都在同一事务里写 `approval(expired)`，并把待审批调用与同批后续调用按 W1 停止规则补为“未执行：任务已停止”。补结果同时记为上下文事件，保证按事件重建请求一致。所以下一次运行的第一次请求不再有悬空调用。
7. **等待审批时的消息：** 聊天接口返回 409，不把消息当作隐式拒绝。循环挂起的瞬间如果已经有排队消息（竞态），任务层写 `approval(expired)` 后在同一运行里处理这条消息，悬空调用按等待提问的规则补为“未执行：等待用户回复后重新决策”。
8. **轮次与计数：** 挂起所在轮的 turn(completed) 在等待前发出，`tool_call_ids` 不含挂起的调用。续接时批准执行的调用落在两轮之间，计入运行的 `tool_calls`，按事件重建请求仍与实际请求一致（有自动测试与 PostgreSQL 往返覆盖）。
9. **事件持久化：** 审批事件存在既有 `events.payload`（JSONB）里，`runs.reason` 也是字符串列，所以没有新迁移。
10. **评测变体 ID：** `E6-deny` 排序在 E6 之后、E7 之前（`_order` 按前缀、编号、后缀排序）。E6 的环境会临时改写工具策略表并在结束时恢复。
11. **既有测试：** W2 的 MCP 结果整形测试走真实循环，默认 `mcp:*`=ask 会让它停在审批，所以改为显式传入 `mcp:*`=allow。

阶段 B（前端接入与实际环境验收）以代码与运行结果为准补充以下修正：

12. **审批条目的构造：** 挂起的调用没有工具事件，投影直接用审批事件的 `name`、`function`、`args` 构造调用视图，MCP 标题用 `service` / `service_tool`（「调用 MCP 工具 w0eval / add」），之后同一调用的工具事件沿用这个名字。结论事件原地更新同一条目；批准后的 `tool(calling/called)` 写回条目里的调用，不另起工具组。审批卡在批准后显示执行中、执行结果或失败说明，并可在工作台查看。
13. **挂起时的 wait：** 后端在审批挂起时同样发 `wait`，投影原先会据此生成一条空的提问条目。补观察脚本用例时发现，改为该运行有 pending 审批时 `wait` 不生成提问条目。
14. **失效的呈现：** `expired` 时调用状态为 `skipped`（「审批已失效，这次调用没有执行」）。停止与重启都会导致失效，卡片文案不区分，原因交给紧随其后的结束条（「你停止了这次运行」或「服务重启导致运行中断」）。
15. **提交中与出错：** 点击批准或拒绝后，按钮保持“正在批准/正在拒绝”直到结论事件到达，而不是接口一返回就恢复，避免续接期间卡片闪回可点状态。接口返回 404、409 时弹出提示并重新拉取详情，以服务端状态为准。
16. **输入框与侧栏：** 等待审批时聊天接口返回 409，所以输入框直接禁用，占位符为「先在上方批准或拒绝这个操作，或点“停止”结束运行」。等待中的调用不进入工作台，批准后才进入。会话列表接口只有 `status`，侧栏徽标由「等你回复」改为「等你处理」，覆盖提问与审批；首页与空列表的说明同步。
17. **设置页分组：** 工具策略分区按“外部工具（`mcp:*`、`a2a:*`）→ 每个 MCP 服务器 → 每个远程 Agent → 内置工具集 → 其他规则”组织，服务器与内置工具集的名单分别取自 MCP、A2A 设置接口与 `builtin_toolsets`（不含 a2a 工具集）。服务器行多一个“跟随”选项，即不写键；内置工具集选“直接执行”即删除键，与兜底 allow 等价。其他规则列出剩余键，可删除，也可按单个函数或 `mcp:服务器:工具` 添加。整表保存，接入既有的未保存提示与离开拦截。
18. **终端实时输出（附带修复）：** 任务要求修复“断网恢复后终端仍显示网络连接失败”。根因不在断网：`ViewShellParams` 自 W5 起把请求字段写成 `shell_session_id`，接口要求 `session_id`，实时读取一直返回 422，终端只在调用结束后显示结果，断网时的错误文字也就一直留着。已改正字段；同时按“调用 ID + Shell 会话”记录读取结果，读取失败时保留上次输出并显示一行提示，浏览器 `online` 时立即重读。走查中断网 6 秒后恢复，提示约 0.3 秒消失，输出继续增长。
19. **评测与走查的执行条件：** 全量评测时 Docker 虚拟机被积压的动态沙箱占满内存，E6 耗时异常、E6-deny 请求超时；清理空闲沙箱后单任务复跑 E6-deny 通过（见交接）。走查“拒绝”一项，脚本原先还要求页面不出现 6912，但 Agent 被拒后改用 Shell 算出了同一结果并说明了原因。判定改为看事件与夹具日志：`denied_by=user`，夹具只收到批准那一次 add。

## 执行效率修订（2026-10-08，已批准）

浏览器动作明确校验引用/坐标组合；fill 覆盖输入，不做部分失败后的自动重放。标签页显式选择，不自动跟随弹窗；引用按观察和页面隔离，失效返回错误。page console/pageerror 使用每 tab 有界缓冲。web_fetch 在沙箱内执行：只允许公开 HTTP(S)、逐跳验证与绑定解析地址、有限重定向/解压后字节/总时间/MIME；不开放 API 宿主任意地址代理。新工具进入策略目录，计划模式仅加入明确读取工具。

验收：覆盖受影响契约的定向检查，与受控页面读数、表单读回和产物展示共同核对；证据和进度只登记总计划。
