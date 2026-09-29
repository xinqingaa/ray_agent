# W10：本地项目、目录与 Git

所属：[二次开发总计划](README.md)。前置：W9（命令注册表，供“选择项目”接入）；依赖 W7.3 的沙箱执行身份与创建参数、W5 的工作台与会话标题栏、W4 的视图模型契约。规模：大，2–3 个对话：对话一做数据、宿主机接入与沙箱绑定；对话二做文件浏览与 Git 只读接口；对话三做界面与端到端验收。后端的前两个对话可以在 W9 后端完成后开始，界面接入命令注册表需要 W9 前端完成。

本文是 2026-09-29 编制的计划，以下内容均为目标，不代表已实现。

## 目标与不做

**目标：** 用户可以把一个会话绑定到宿主机上的一个项目目录。Agent 在沙箱里直接读写这个目录，默认在其中执行命令；用户在界面上能浏览项目文件、预览内容，并看到 Git 的分支、改动列表与 diff，从而确认 Agent 实际改了什么。

**不做：** worktree、变更集与基线（快照、回滚、按运行归集改动）、跨会话记忆；长期项目实体与项目级设置；在界面上执行写入类 Git 操作（暂存、提交、推送、切分支）；Git 凭据或 SSH 密钥注入；按 `.gitignore` 过滤文件树；项目内全文搜索；共享沙箱模式下的项目绑定；访问围栏（工作目录只是默认位置）。

## 已确认决策（2026-09-29）

以下决策已拍板，实施时不改写；与源码冲突时在“实施修正”中记录冲突与处理，决策本身保留。

4. 一个会话绑定一个项目，只能在首次运行前选择或更换；沙箱创建后不允许更换。
5. 文件树与 Git 由 API 侧只读挂载读取，不依赖沙箱是否存活。
6. Agent 在项目里默认允许 git commit/push，写入能力边界；沙箱镜像安装 git。工具策略不按 Shell 参数区分 git 写操作，这一点要写进边界。
7. 允许接入的宿主机根目录由配置项 PROJECT_ROOTS 限定，不允许任意绝对路径。

（编号沿用总计划中的决策编号，1–3 属于 [W9](w9-input-commands.md#已确认决策2026-09-29)。）

## 现状

以下是 2026-09-29 按提交 `d06a1a8` 的静态核对，行号可能随后续提交移动。

- **会话模型：** 领域模型 `Session`（[`domain/models/session.py`](../../ray_agent/api/app/domain/models/session.py) 第 28–42 行）与 ORM `SessionModel` 字段一一对应，没有项目字段；仓库接口按字段提供专门的更新方法（`update_sandbox_id`、`set_title` 等，`domain/repositories/session_repository.py`）。最近一次加列是迁移 `a7d9215bc8e0`（`sessions.title_source`，`op.add_column` 带 `server_default`）。
- **会话接口：** 列表条目 `ListSessionItem` 只有标题、最新消息、状态与未读数（`interfaces/schemas/session.py` 第 19–26 行）；创建会话 `POST /sessions` 没有请求体。首页先创建会话再 chat（`app/page.tsx`）。
- **沙箱创建：** `_create_task()`（[`docker_sandbox.py`](../../ray_agent/api/app/infrastructure/external/sandbox/docker_sandbox.py) 第 126–183 行）的容器参数只有镜像、名称、限额、环境变量与网络，没有卷挂载；`create()` 不接收参数，`SANDBOX_ADDRESS` 设置时直接连接已有沙箱（第 186–198 行）。沙箱在第一次 chat 创建任务时按需创建，找不到容器（例如 TTL 到期被删）时重新创建并更新 `sessions.sandbox_id`（`agent_service.py` 第 99–113 行）。
- **Compose：** `manus-api` 只挂载 `docker.sock` 与文件存储卷（`docker-compose.yml` 第 63–66 行），经 docker.sock 创建的沙箱是宿主机上的兄弟容器，绑定源路径由宿主机的 Docker 守护进程解析。
- **执行目录与提示词：** 提示词环境段写死“工作目录为 /home/ubuntu（HOME 也是这个目录）；用户上传的附件位于 /home/ubuntu/upload”（`prompts/system.py` 第 26 行，英文版同）。`shell_execute` 的 `exec_dir` 是必填参数，由模型给出（`tools/shell.py` 第 27–36 行）。上传同步到 `/home/ubuntu/upload/<文件名>`（`agent_task_runner.py` 第 174 行），结果落盘在 `/home/ubuntu/.rayagent/outputs`。记忆里的 system 消息在第一次运行时写入后不再改变（`agent_loop.py` 第 941–945 行），所以按项目生成的环境段在首次运行后就固定了，这与决策 4 一致。
- **镜像：** 沙箱镜像（`ubuntu:22.04`）与 API 镜像（`python:3.12-slim`）的 Dockerfile 都没有安装 git。API 容器没有 `USER` 指令，以 root 运行。
- **工作台：** 按工具家族打开结果、终端、浏览器或文件页（[W5 完成后界面微调](w5-ux.md#完成后界面微调2026-09-29)），没有项目或变更页。

## 设计

### 数据：会话上的项目字段

**决定：** 在 `sessions` 上增加一个可空列 `project_path`（宿主机上的规范化绝对路径，即校验通过后的 realpath），不建项目表。项目名取路径最后一段；分支等 Git 信息每次实时读取，不入库。

**理由：**

- 决策 4 规定一个会话只绑定一个项目，且首次运行后不能改，关系是会话的一个属性，和 `sandbox_id`、`title_source` 同类；沿用现有的“领域模型字段 + ORM 列 + 仓库专门方法 + `op.add_column` 迁移”写法即可。
- “最近项目”可以从会话行聚合（按 `project_path` 分组、取最近的 `latest_message_at` 或 `updated_at`），不需要独立实体。
- 项目表会带来独立的生命周期（改名、删除、引用计数、项目级设置），这正是“长期项目工作区”的起点，而 worktree、变更集与基线仍不在范围内。
- 代价：删除某路径的全部会话后，它不再出现在最近项目里；宿主机目录被移动或删除后，会话只能显示“项目目录不可用”。这两点都可以接受。

**接口与契约：**

- 会话详情与列表条目增加 `project`：`{path, name, available, reason}`；`available` 按当前 `PROJECT_ROOTS` 与路径校验实时判断，`reason` 说明不可用的原因（不在允许的根目录内、不存在、不是目录）。没有绑定时为 `null`。
- `PUT /sessions/{id}/project`（body `{"path": "..."}`）绑定或更换，`DELETE /sessions/{id}/project` 解除。会话已有运行，或 `sandbox_id` 不为空时返回 409（决策 4）；设置了 `SANDBOX_ADDRESS` 时返回 409，说明共享沙箱模式不支持绑定项目；路径校验失败返回 400 并给出具体原因。
- `GET /projects/roots` 返回允许的根目录；`GET /projects/browse?path=` 列出某根目录内一层子目录（只列目录，标出哪些是 Git 仓库）；`GET /projects/recent` 返回最近项目。
- 前端 `lib/api/types.ts` 与 [W4 视图模型契约](w4-ui-data.md#视图模型契约)同步：`SessionView.project`，以及工作台“项目”“变更”页使用的树节点、文件预览、Git 状态与 diff 类型。

### 宿主机接入

- **配置：** API 运行时配置增加 `PROJECT_ROOTS`，逗号分隔的宿主机绝对路径；为空时整个功能关闭，界面不显示项目入口。启动时对每个根目录取 realpath 并确认在 API 容器内存在，不存在的根目录记日志并不可选。不允许绑定根目录之外的任意绝对路径（决策 7）。
- **Compose：** 默认的 `docker-compose.yml` 不挂载任何宿主机目录。提供一个覆盖文件示例（如 `docker-compose.projects.example.yml`），对每个根目录写一条“宿主机路径 : 相同路径 : ro”的只读挂载到 `manus-api`；用户复制后填入自己的路径，仓库里不写真实路径。挂成相同路径，是为了让 API 在容器内看到的路径就是宿主机路径，可以直接作为沙箱的绑定源。
- **路径校验**（绑定、浏览与每次读取都走同一个函数），依次检查：
  1. 取 realpath（解析 `..` 与全部符号链接）；
  2. 结果是否在某个允许根目录的 realpath 之内（按路径段比较，不按字符串前缀）；
  3. 是否存在；
  4. 是否为目录；
  5. 符号链接逃逸：项目内的相对路径（文件树与读文件）同样先取 realpath，结果必须仍在项目目录的 realpath 之内；文件树中指向项目外的符号链接只显示为链接，不跟随、不读取。
- **沙箱绑定：** `DockerSandbox.create()` 接收可选的项目路径；有项目时容器参数增加一条卷挂载，源为宿主机路径，目标为固定的容器内路径 `/workspace`，读写。沙箱因 TTL 到期被删后重新创建时，从会话读取同一个 `project_path` 再次绑定。设置了 `SANDBOX_ADDRESS` 时，绑定了项目的会话创建任务直接失败，给出“共享沙箱模式不支持绑定项目”的错误，而不是悄悄不挂载。
- **为什么绑定源必须是宿主机路径：** API 容器通过 docker.sock 让宿主机的 Docker 守护进程创建兄弟容器，卷的源路径由守护进程在宿主机上解析，不是 API 容器内的路径。API 侧的只读挂载与沙箱侧的读写挂载是同一个宿主机目录的两个挂载，前者不影响后者的读写权限。

### 执行目录

- 提示词环境段按是否绑定项目生成：有项目时说明 `/workspace` 是用户电脑上项目目录的读写挂载、也是默认工作目录，修改会直接写到宿主机；上传附件仍在 `/home/ubuntu/upload`，超长结果仍落盘在 `/home/ubuntu/.rayagent/outputs`，临时文件不要写进项目；git 可用。没有项目时保持现有文字。中英文各一份。
- `shell_execute` 的 `exec_dir` 改为可选，缺省时用项目目录（有项目）或 `/home/ubuntu`（无项目）；显式传入时照旧。
- 上传文件与结果落盘的路径不变，都在项目目录之外；测试断言绑定项目后二者都不写进 `/workspace`。

### 文件浏览（API 只读）

- `GET /sessions/{id}/project/tree?path=<相对路径>`：按层懒加载，只返回该目录的直接子项（名称、类型、大小、修改时间、是否符号链接）。默认忽略 `.git`、`node_modules`、`.venv`、`__pycache__`、`.next`、`.DS_Store`；每层条目数上限（暂定 1000），超出时截断并返回 `truncated`。
- `GET /sessions/{id}/project/file?path=`：读文件内容，大小上限（暂定 1 MB，超出返回元数据与“文件过大”）；读取前检测二进制（前 8 KB 含 NUL 字节），二进制只返回元数据。
- 这些接口读的是 API 容器内的只读挂载，不访问沙箱，沙箱不存在或已销毁时照常工作（决策 5）。

### Git（API 只读）

- 统一调用 `git -C <path> -c safe.directory=<path> -c core.quotepath=false --no-optional-locks …`，并设置 `GIT_OPTIONAL_LOCKS=0`、`GIT_TERMINAL_PROMPT=0`。`safe.directory` 用于 API 以 root 读取属主不同的仓库；不取可选锁，避免在只读挂载上尝试写索引。
- **状态：** `GET /sessions/{id}/project/git/status`，执行 `status --porcelain=v2 -b`，返回分支、上游与领先落后数，以及条目（普通改动、重命名、冲突、未跟踪；暂存区与工作区状态分开）。
- **diff：** `GET /sessions/{id}/project/git/diff?scope=worktree|staged[&path=]`，分别对应工作区相对暂存区、暂存区相对 HEAD；带 `path` 时只取该文件。没有提交的新仓库，暂存区 diff 以空树为基准；未跟踪文件的单文件 diff 显示为全部新增；二进制文件只标出“二进制文件已更改”。
- **限制：** 每次调用有超时（暂定 10 秒）；状态条目数与 diff 输出有大小上限（暂定 2000 条、512 KB），超出时截断并标明。
- **非仓库：** 目录不是 Git 仓库时返回明确状态 `not_a_repository`，界面显示“这个项目不是 Git 仓库”，不当作错误。
- **镜像：** API 镜像安装 git；沙箱镜像也安装 git（决策 6），并对 `/workspace` 设置系统级 `safe.directory`，否则宿主机目录属主不是 uid 1000 时沙箱里的 git 会拒绝操作。沙箱不预设提交身份，不注入凭据。

### 界面

- **首页：** 输入框旁的项目选择器，列出最近项目，并可在允许的根目录内逐层浏览选择；选定后在发送时先创建会话、绑定项目，再 chat。通过 W9 的命令注册表注册“选择项目”（`/project`），可用条件是首页或尚未开始首次运行的会话，否则显示“项目只能在首次运行前选择”；`PROJECT_ROOTS` 为空时不注册。
- **会话标题栏：** 显示项目名与当前分支；项目不可用时显示原因。分支来自 Git 状态接口，不在会话详情里。
- **工作台“项目”页：** 文件树（按层展开）加文件预览，二进制与过大文件显示说明。
- **工作台“变更”页：** Git 状态列表加选中文件的 diff；手动刷新；文件类工具（`write_file`、`replace_in_file`）完成后自动刷新，Shell 调用结束后同样刷新（Shell 也可能改文件），刷新做节流。非仓库时显示说明。
- 两个页只在会话绑定了项目时出现，不参与 W5 的“按工具家族默认打开”规则。

### 能力边界

以下各条在实现完成后写入[能力与边界](../capabilities.md)，本计划阶段不改该文件：

- macOS 上 Docker Desktop 只能挂载其“文件共享”设置里包含的目录，根目录不在共享范围内时挂载失败或为空；
- Linux 上沙箱以 ubuntu（uid 1000）写入，宿主机用户 uid 不是 1000 时，Agent 新建的文件属主是 1000，原有文件若对 uid 1000 不可写，写入会失败；
- 工作目录只是默认位置，不构成访问围栏：Agent 仍可读写沙箱内项目以外的路径，项目内也没有按路径的限制；
- Agent 在项目里默认可以执行 `git commit` 与 `git push`，会直接改变宿主机仓库的历史与远端；工具策略只按工具判断，不按 Shell 参数区分 git 写操作，要禁止只能把整个 `shell:*` 设为 ask 或 deny；沙箱不注入凭据，push 是否成功取决于远端与用户自行配置；
- 文件树与 Git 读取的是 API 容器内的只读挂载，看到的是宿主机当前状态，不按运行归集改动，也不能回滚。

## 改动清单

- API 领域与基础设施：`Session.project_path`、ORM 列与仓库方法；迁移（`sessions.project_path`）；路径校验模块；文件浏览与 Git 只读读取（基础设施层实现，应用层协调）；`DockerSandbox.create()` 的项目参数与卷挂载；`SANDBOX_ADDRESS` 下的拒绝；`shell_execute` 的 `exec_dir` 默认值；提示词环境段。
- API 应用与接口层：项目绑定、浏览、最近项目、文件树、读文件、Git 状态与 diff 的路由与响应结构；会话详情与列表返回 `project`。
- 配置与镜像：`core/config.py` 的 `project_roots`；`.env.example` 增加空的 `PROJECT_ROOTS`；Compose 覆盖文件示例；API 与沙箱 Dockerfile 安装 git，沙箱设置 `safe.directory`。
- UI：`lib/api/` 的项目与 Git 请求；投影与类型的 `project`；首页项目选择器与“选择项目”命令；会话标题栏；工作台“项目”“变更”页；组件状态目录补充新状态。

## 验收

**自动测试：**

1. 路径校验：根目录外的路径、`..` 越界、指向根目录外的符号链接、不存在、是文件不是目录，各返回对应原因；根目录内的正常目录通过；项目内相对路径的越界与符号链接逃逸被拒绝。
2. 沙箱创建（mock docker client）：有项目时卷挂载的源为宿主机路径、目标 `/workspace`、读写；无项目时没有卷；`SANDBOX_ADDRESS` 设置且绑定了项目时报错。
3. 绑定接口：首次运行前可绑定与更换；已有运行或已有 `sandbox_id` 时返回 409；共享沙箱模式返回 409。
4. Git 读取（临时仓库）：新增并暂存、修改未暂存、删除、未跟踪、二进制文件、没有提交的新仓库、非仓库目录，状态与 diff 各符合预期；超时与大小上限生效。
5. 文件浏览：忽略目录不出现、条目数上限截断、过大文件与二进制只返回元数据。
6. 执行目录：绑定项目时 `shell_execute` 省略 `exec_dir` 使用 `/workspace`；上传同步与结果落盘都不写进 `/workspace`；提示词环境段按是否绑定项目不同。
7. 接口测试：会话详情与列表的 `project` 字段、`available` 与 `reason`；最近项目按时间排序。

**评测：** 复跑 E1、E2、E4 各 1 次（未绑定项目），确认执行目录改动没有回退。

**端到端（Compose 与真实模型）：** 在允许的根目录下建一个临时 Git 仓库并提交一个文件；首页选择该项目并发起“修改这个文件并新增一个文件”的任务；工作台“变更”页出现修改与未跟踪两项，diff 与宿主机上 `git diff` 一致；在宿主机上确认文件确实被改动；标题栏显示项目名与分支；销毁该会话的沙箱后，“项目”与“变更”页仍可读取。macOS Docker Desktop 下走一遍；Linux 属主情况如无环境，在报告中写明未验证。

## docs 同步

- [产品说明](../product.md)：项目绑定、项目与变更页；
- [架构说明](../architecture.md)：宿主机目录的两个挂载（API 只读、沙箱读写）与数据归属；
- [能力与边界](../capabilities.md)：上文“能力边界”各条，以及“尚未具备”中“长期项目工作区”一行改为只剩 worktree、变更集与基线；
- [代码地图](../code-map.md)：项目、路径校验、Git 读取、工作台新页；
- [运行指南](../../ray_agent/README.md)、[Docker 操作说明](../../ray_agent/DOCKER.md)、[沙箱开发指南](../../ray_agent/sandbox/README.md)：`PROJECT_ROOTS`、覆盖文件、Docker Desktop 文件共享、镜像里的 git；
- [W4 子计划](w4-ui-data.md#视图模型契约)：契约字段。

以上在实现完成后更新，本计划阶段不改。

## 交接

给课程同步（L）：项目绑定是会话属性而不是长期工作区；API 只读挂载与沙箱读写挂载的分工；Git 只读查看不构成变更集或基线。

已知未决：各项上限的具体数值（文中为暂定）；Compose 覆盖文件的命名与放置；Linux 下 uid 不一致时是否提供可选的 uid 映射（本包不做，只写边界）。

## 实施修正（2026-09-29，第一批：基础设施）

第一批只做与会话模型、路由、提示词解耦的部分，代码未提交；新增 56 项测试通过，全量 pytest 255 通过、10 跳过、1 个既有错误（`test_status_routes` 需要真实数据库与 Redis，与本包无关）。镜像构建被中断，**两个镜像里的 git 未验证**。

1. **接口形状：** 路径校验在 `domain/services/project_paths.py`：`check_project_path(path, roots) -> PathCheck`、`resolve_in_project(project_path, relative, roots, expect="any|directory|file", must_exist=True) -> PathCheck`、`resolve_roots(roots) -> List[ProjectRoot]`，原因为枚举 `PathCheckReason`。文件读取 `infrastructure/external/project/local_project_files.py` 的 `LocalProjectFiles(roots)`：`list_directory(project_path, relative="") -> ProjectListing`、`read_file(project_path, relative) -> ProjectFile`、`browse(path) -> BrowseListing`，校验失败抛 `ProjectPathError`。Git 读取 `git_reader.py` 的 `GitCliReader(roots)`：`status(project_path) -> GitStatus`、`diff(project_path, scope="worktree"|"staged", path=None) -> GitDiff`，`state` 为 `ok`、`not_a_repository`、`timeout`、`error`。领域接口在 `domain/external/project.py`，数据类型在 `domain/models/project.py`。沙箱为 `DockerSandbox.create(project_path: Optional[str] = None)`，共享沙箱模式下传入项目抛 `SandboxProjectBindingError`。
2. **仓库配置不能让 API 执行命令：** 沙箱对 `.git/config` 可写，而 API 容器持有 docker.sock，仓库里配置的 fsmonitor、clean/smudge filter 与外部 diff 驱动会在 API 读取时被执行。实现置空了这些配置，并用 `GIT_WORK_TREE` 固定工作区为项目目录；有测试证明不加覆盖时这些命令确实会执行。设计里的命令行因此比“Git（API 只读）”一节多出这些参数。
3. **其他出入：** 忽略子模块改动；pathspec 按字面处理（`--literal-pathspecs`）；沙箱挂载用 mount 而不是 bind 简写，源目录不存在时报错，不会在宿主机上新建空目录；`PROJECT_ROOTS` 拒绝相对路径和 `/`；API 启动时（`main.py`）检查各根目录并记录不可用的根目录。
4. **Compose 与忽略：** 新增 `docker-compose.projects.example.yml`；`.gitignore` 忽略用户复制出的覆盖文件。

## 第二批的已定细节（2026-09-29 协调者决定，接手者按此实施）

- **迁移：** 新迁移 `sessions.project_path`（`String`，可空，无默认值），`down_revision = 'c3f8e1a2b7d4'`（W9 的 `runs.mode`），保持单一 head。领域 `Session.project_path: Optional[str]`，仓库新增 `set_project_path(session_id, path_or_none)`。
- **绑定接口：** 按上文 `PUT/DELETE /sessions/{id}/project`。放在应用层新服务 `ProjectService`（不塞进 `AgentService`），在 `session_lock(session_id)` 内判断：会话不存在 404；`settings.sandbox_address` 已设置 409；会话已有任一运行或 `sandbox_id` 非空 409（决策 4）；`check_project_path` 失败 400，`msg` 为原因的中文说明。成功返回会话的 `project` 对象。`PROJECT_ROOTS` 为空时 PUT 返回 400“未配置允许的项目根目录”。
- **首页流程：** 不改 `POST /sessions`；首页按“创建会话 → PUT 项目 → chat”三步走，PUT 失败时不发 chat，保留输入并提示原因（已创建的空会话留在列表里，与现有空会话一致）。
- **`project` 字段：** 会话详情与列表条目都带 `project: {path, name, available, reason} | null`。`available`/`reason` 每次请求用 `check_project_path` 实时计算，只对 `project_path` 非空的会话计算；列表流每 5 秒推送也照此计算，不加缓存（每个会话一次 realpath 与 stat）。
- **项目浏览接口：** `GET /projects/roots` → `{enabled, roots: [{path, available}]}`，`enabled` 为 `PROJECT_ROOTS` 非空；`GET /projects/browse?path=` → `LocalProjectFiles.browse`；`GET /projects/recent?limit=10` → 按 `project_path` 分组、取组内最大 `updated_at` 倒序，每项同样带 `available`/`reason`。
- **会话内读取接口：** `GET /sessions/{id}/project/tree?path=`、`/project/file?path=`、`/project/git/status`、`/project/git/diff?scope=&path=`，都走 `ProjectService` 取会话的 `project_path` 后调用第一批的读取器；会话未绑定项目返回 404“会话没有绑定项目”；`ProjectPathError` 返回 400；Git 的 `not_a_repository`、`timeout` 作为 200 的 `state` 返回，不当错误。
- **沙箱与任务接线：** `AgentService._create_task` 从会话读 `project_path`，调用 `self._sandbox_cls.create(project_path=...)`；TTL 到期重建沙箱的分支同样传入。`SandboxProjectBindingError` 转为 409。`AgentTaskRunner` 构造参数增加 `workspace_dir: Optional[str]`（有项目时为 `/workspace`），传给 `build_default_tools`（Shell 的默认执行目录）与 `AgentLoop(system_prompt=build_system_prompt(workspace_dir))`。
- **提示词：** `prompts/system.py` 与 `prompts/en/system.py` 各提供 `build_system_prompt(workspace_dir: Optional[str]) -> str`，保留 `SYSTEM_PROMPT = build_system_prompt(None)` 以兼容现有引用与测试；无项目时输出与现在逐字相同（加断言测试）。有项目时环境段按上文“执行目录”一节替换工作目录那一行。W9 的计划模式后缀照旧在请求时拼接，两者互不影响。
- **`shell_execute`：** `exec_dir` 从 `required` 中移除，工具集构造时接收 `default_exec_dir`（有项目 `/workspace`，否则 `/home/ubuntu`），调用缺省时使用它；参数说明写明缺省值。
- **前端：** `lib/api/` 增加 `projectApi`（上面各接口）与类型；`SessionView.project`（W4 契约同步）；首页项目选择器是输入框工具行上的 Popover（最近项目列表 + “浏览…”逐层进入根目录，Git 仓库标图标），`PROJECT_ROOTS` 未启用时不渲染；注册表命令 `/project`（`id: 'project'`，放在最后），`CommandContext` 加 `projectsEnabled`、`projectBindable`（首页，或会话 `hasRuns` 为假），`projectsEnabled` 为假时 `available` 之外直接从列表过滤掉该命令；不可用原因“项目只能在首次运行前选择”。会话标题栏显示项目名与分支（分支来自 `git/status`，进入会话时取一次，此后随“变更”页刷新更新）；项目不可用时显示 `reason`。
- **工作台：** `workbench.tsx` 在会话有 `project` 时增加“项目”“变更”两个页签，不参与按工具家族默认打开。“项目”页按层懒加载树，点文件读取预览（二进制、过大显示说明）。“变更”页列出 `git/status` 条目，选中后取单文件 diff（暂存与工作区分开显示），有手动刷新；事件流里 `write_file`、`replace_in_file`、`shell_*` 的 `tool(called)` 完成后自动刷新，1 秒内多次合并为一次。

## 实施修正（2026-09-29，第二批后端）

第二批只做后端，未改 UI，也未改 W9 的计划模式、压缩与 compact 路由。下面只记与「第二批的已定细节」不一致的地方。

1. **`sessions.project_path` 长度：** 已定细节写 `String`、可空、无默认值，没有给长度。列与 ORM 用 `String(4096)`。会话 id 那类列是 255，装不下常见的宿主机路径。
2. **Git `state=error`：** 已定细节点名 `not_a_repository` 与 `timeout` 以 200 的 `state` 返回。读取器还会返回 `error`，接口同样以 200 交出，不转成 5xx。

## 实施修正（2026-09-29，前端）

1. **浏览入口：** 选择器「浏览目录…」先列出 `GET /projects/roots` 返回的各根目录，再对选中根调用 `browse`；不是直接进入第一个可用根。
2. **会话页绑定：** 在尚未开始首次运行的会话里，选定项目后立即 `PUT` 绑定并刷新详情，不在发送消息时再绑。
3. **变更页 diff 范围：** 条目仅有暂存改动、工作区干净时取 `scope=staged`，否则取 `worktree`；与「暂存与工作区分开显示」一致，未做双栏并列。
4. **Git 分支同步：** 标题栏分支除进入会话时拉取 `git/status` 外，还接收变更页刷新回调；工具触发的合并刷新只驱动变更页，标题栏分支随变更页刷新更新。
