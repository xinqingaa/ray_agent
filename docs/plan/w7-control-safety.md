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

- 沙箱 `exec_command` 创建子进程后直接 `await` 输出读取协程（[`sandbox/app/services/shell.py`](../../ray_agent/sandbox/app/services/shell.py) 第 236、266 行）。读取协程要到输出结束才返回，推断会让接口阻塞到进程退出，第 270–273 行的 5 秒等待因此失效；与 2026-09-09 观察到 `sleep 6` 约 6 秒后返回 completed 一致（见[背景](../background/README.md#工作区调研的本地观察)）。该推断尚未经 Docker/HTTP 实测。
- API 调用沙箱的 HTTP 客户端超时为 600 秒（[`docker_sandbox.py`](../../ray_agent/api/app/infrastructure/external/sandbox/docker_sandbox.py) 第 39 行）；W1 之前工具异常会重试 3 次，长命令可能被重复执行。
- 子进程用 `create_subprocess_shell` 启动，终止只作用于 bash 进程本身（shell.py 第 60–76、368–404 行），命令派生的子进程可能留下。
- 沙箱 FastAPI 以 root 运行（[`supervisord.conf`](../../ray_agent/sandbox/supervisord.conf) 第 26–38 行）；镜像创建了带免密 sudo 的 ubuntu 用户（[`Dockerfile`](../../ray_agent/sandbox/Dockerfile) 第 20–22 行）。
- 创建容器时没有 CPU、内存、进程数限制；API 注入 `SERVICE_TIMEOUT_MINUTES`，沙箱读取 `server_timeout_minutes`（docker_sandbox.py 第 122–134 行；[`sandbox/app/core/config.py`](../../ray_agent/sandbox/app/core/config.py) 第 16 行）。
- 敏感操作前确认只写在提示词里，工具分发前没有策略检查。

## 设计

### W7.1 Shell 执行与进程组

- 输出读取协程用 `asyncio.create_task` 启动后不等待，保存任务引用以便结束时清理；`exec_command` 等待进程最多 5 秒，未结束返回 `running`，已结束返回完整输出。
- 子进程以新会话启动（`start_new_session=True`），终止时对进程组先发 SIGTERM，有界等待（默认 3 秒）后发 SIGKILL，返回实际结果。同一 Shell 会话执行新命令前终止旧进程时也按进程组处理。
- W3 的停止传播调用的就是这个终止接口；本项完成后，E4 的“停止后标记不再增长”才有意义。
- API 侧 Shell 工具的等待超时与 HTTP 超时对齐：`shell_wait_process` 的等待秒数加上余量小于 HTTP 超时，避免 HTTP 超时先于业务超时触发。

### W7.2 工具级审批

- 配置：在应用配置中新增工具策略表，按工具名（MCP/A2A 按服务名加工具名）设置 `allow`、`ask`、`deny`，未列出的工具为 `allow`。默认策略：沙箱内的文件、Shell、浏览器、检索为 allow；MCP 与 A2A 工具为 ask，操作者可在配置中改为 allow。编辑入口在 W5 设置页预留的“工具策略”分区实现。
- 分发前检查：作为 W1 工具管线执行前段的处理函数。`deny` 短路为“策略禁止”的失败结果，不执行；`ask` 时循环发出审批请求事件，运行进入 waiting，原因 `approval`，退出协程。同一批次中该调用之后的调用不执行。
- 回复：`POST /sessions/{id}/approvals/{tool_call_id}`，body 为 approve 或 deny。批准时执行该调用一次并回填结果；拒绝时回填“用户拒绝执行”。两种情况下，同一批次后续未执行的调用都按 W1 的悬空调用规则补为未执行，然后请求模型。批准只对这一个调用有效。
- 等待审批时 API 重启：启动扫描把该运行置为 interrupted（原因 `api_restart`），待审批的调用补为未执行；用户需要重新发起任务。这与等待提问时重启可以续接不同，原因是批准针对的是重启前的执行环境。
- 重复回复或回复已结束的审批返回冲突错误，不重复执行。
- 界面：W4 视图模型的 `approval` 条目与 `waiting_approval` 动作接入审批事件；W5 的审批卡接入批准与拒绝接口，覆盖其全部状态。

### W7.3 执行身份与资源限制

- 沙箱 FastAPI 改为 ubuntu 用户运行，`HOME` 与工作目录为 `/home/ubuntu`；需要 root 的操作通过 sudo 完成，与提示词描述一致。核对文件上传目录、W2 的输出落盘目录与浏览器进程的权限。
- 容器创建时设置内存、CPU 与进程数上限，默认值写入 API 配置并可调整（例如 2 GB、2 CPU、512 个进程）。
- TTL 环境变量统一为沙箱读取的名称，修改 API 侧的 `sandbox_ttl_minutes` 能改变实际存活时间。
- 提示词中的环境描述按修改后的镜像更新（执行身份、Python 3.10、Node 24、工作目录）。

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

W8 依赖：审批与停止的真实行为；检查脚本的输出；新的配置项及默认值。
