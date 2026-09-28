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

- 配置：在应用配置中新增工具策略表，按工具名（MCP/A2A 按服务名加工具名）设置 `allow`、`ask`、`deny`，未列出的工具为 `allow`。默认策略：沙箱内的文件、Shell、浏览器、检索为 allow；MCP 与 A2A 工具为 ask，操作者可在配置中改为 allow。编辑入口在 W5 设置页预留的“工具策略”分区实现。
- 分发前检查：作为 W1 工具管线执行前段的处理函数。`deny` 短路为“策略禁止”的失败结果，不执行；`ask` 时循环发出审批请求事件，运行进入 waiting，原因 `approval`，退出协程。同一批次中该调用之后的调用不执行。
- 回复：`POST /sessions/{id}/approvals/{tool_call_id}`，body 为 approve 或 deny。批准时执行该调用一次并回填结果；拒绝时回填“用户拒绝执行”。两种情况下，同一批次后续未执行的调用都按 W1 的悬空调用规则补为未执行，然后请求模型。批准只对这一个调用有效。
- 等待审批时 API 重启：启动扫描把该运行置为 interrupted（原因 `api_restart`），待审批的调用补为未执行；用户需要重新发起任务。这与等待提问时重启可以续接不同，原因是批准针对的是重启前的执行环境。
- 重复回复或回复已结束的审批返回冲突错误，不重复执行。
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

W7.2 尚未实施。审批策略、事件、接口、启动扫描与界面接入的交接留空，待该子项完成时补写。

给 W8（W7.1、W7.3，2026-09-28）：

- **停止与进程组：** W3 的 `stop_processes` 仍调用沙箱 `kill_process`，最多等 10 秒，结果写入 `cleanup`。终止打到进程组：SIGTERM，约 3 秒后组内仍有非僵尸进程则 SIGKILL。外壳已经退出后不再 `killpg`。同一 Shell 会话执行新命令前也按组终止。E4 的前台 `sleep` 循环会响应 SIGTERM，因此日志是返回码 -15，没有走到 SIGKILL；忽略 SIGTERM 的子进程由沙箱 `tests/test_shell_service.py` 覆盖。
- **Shell 初次返回：** `exec_command` 最多等 5 秒。未结束时沙箱记一条等待超时（`BadRequestException`），接口返回 `running`，读取协程继续跑。API 侧 `DockerSandbox.wait_process` 把等待秒数截断到 570（HTTP 读超时 600 减去余量 30）。未传或非正数仍由沙箱按默认 60 秒处理。截断只在适配层，工具层不重复。
- **执行身份：** Supervisor 管理的服务（FastAPI、Chromium、Xvfb、x11vnc、socat、websockify）以 `ubuntu` 运行，`HOME` 与工作目录 `/home/ubuntu`。supervisord 主进程仍是 root。`Xvfb -ac`。上传目录与 `/home/ubuntu/.rayagent/outputs` 第一次写入时创建，路径未改。W2 交接里“当前以 root 运行”已被本包取代。
- **限额与 TTL：** 动态创建时 `mem_limit` 与 `memswap_limit` 同为 `SANDBOX_MEMORY_MB`（默认 2048）MiB，`nano_cpus` 为 `SANDBOX_CPUS`（默认 2）×10⁹，`pids_limit` 为 `SANDBOX_PIDS_LIMIT`（默认 512）。`SANDBOX_ADDRESS` 已设置时不创建容器，不套用限额。`SANDBOX_TTL_MINUTES`（默认 60）注入为沙箱读取的 `SERVER_TIMEOUT_MINUTES`，不再注入 `SERVICE_TIMEOUT_MINUTES`。多数 `/api` 请求会把剩余销毁时间延长 3 分钟，所以检查到的剩余时间可以大于 60 分钟。
- **检查脚本：** 在 API 容器内执行 `python scripts/check_sandbox_environment.py`（宿主机 `uv run` 读的是 `api/.env`，不一定与 Compose 一致）。2026-09-28 通过：用户 ubuntu、uid 1000、HOME 与工作目录 `/home/ubuntu`、Python 3.10.12、Node v24.21.0；上述服务进程用户均为 ubuntu；上传目录与输出目录属主 ubuntu；内存与 swap 2147483648、NanoCpus 2000000000、PidsLimit 512；`SERVER_TIMEOUT_MINUTES=60` 且没有 `SERVICE_TIMEOUT_MINUTES`；超时计时活动，剩余约 5400 秒。
- **评测：** [w7-1-3-2026-09-28-4b413ef](evidence/w7-1-3-2026-09-28-4b413ef.md)，只跑 E2、E4 各 1 次，对照 W2。E2 通过（`total` 60，source.csv 未改）。E4 通过：停止后标记停在 8 行，10 秒内不增长；`cleanup` 为 `shell e4 success=True`。停止后 `docker exec` 进 `rayagent-sandbox-fbda657d`：进程列表里没有该循环，标记文件 8 行、属主 ubuntu，再等 5 秒仍是 8 行；该容器 HostConfig 与默认限额一致。E1–E5 全量与 E6 留到 W7.2 完成时。
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
