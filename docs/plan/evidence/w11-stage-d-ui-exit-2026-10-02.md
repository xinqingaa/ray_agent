# 阶段 D 界面补验（2026-10-02）

日期：2026-10-02。产品提交 `b95ab11e352482c647f12b07787580909ad4ca08`，另有未提交的界面改动（运行前保护跳过进入时间线；文件夹选择遇到 `SecurityError` / `NotAllowedError` 时进入既有 webkitdirectory 警告）。无提交、无推送、无 tag、无课程修改。W9/W10/W11 仍为进行中。阶段 E 未开始。

## 运行条件

- 网关 `http://127.0.0.1:8088` 返回 200。`manus-api`、`manus-ui`、`manus-postgres`、`manus-redis` healthy；`manus-nginx` 在运行。
- 运行中的 UI 镜像 `sha256:4b489193b58adf1474633d70bdda11260ac93db187ab1a4e475c73441a2d5773`，包含上述未提交界面改动。
- 运行中的 API 镜像 `sha256:766d33b91334d4f326997592f4e1309202785c2a7ea976dffc8bb98b336d692d`。本轮没有改 API 源码，也没有重建 API 镜像。
- 浏览器是 Cursor 内置浏览器，标签 `4523eb`。390×844 用设备度量覆盖，测完已清除，窗口回到 638×443。
- 本轮没有新发摘要请求，也没有点击「以相同内容重试」。已有失败会话里的 401 正文含凭据形状的片段，证据不抄录该片段，含该片段的画面也不入库。

## 已在浏览器看到的结果

**导航。** 项目菜单实际列出「在此项目新对话」「项目设置」「归档项目」，见 [390 菜单](w11-stage-d-ui-390-menu-2026-10-02.png)。标题栏项目名与加号见 [会话窄屏](w11-stage-d-ui-390-session-2026-10-02.png) 和 [标题栏](w11-stage-d-ui-nav-title-2026-10-02.png)。从标题栏进入项目页后，输入框占位为「在 stage-d-overlimit-20261002 中开始新对话」，发送按钮禁用，见 [空白输入](w11-stage-d-ui-390-blank-2026-10-02.png)。点击前后会话总数都是 5，没有新建会话。

**重试本次恢复。** 项目 `c6900f0b-1373-4a2b-9f47-7b0845df3735`（stage-d-retry-20261002）。独立工作进程在真实卷上注入覆盖阶段失败后，浏览器点「重试本次恢复」并确认。故障发生在目标文件已经发布之后，所以点击前磁盘已经是目标树；界面仍显示失败并禁止上传与发送。确认后文件操作清空。事后读回：根 inode `539452`，`source.csv` 31 字节、sha256 `7d99d75e14563a94bb420dc1fd994a4e51d89be413bcd1deb9652cbd95e18125`、uid 1000，`source-link` 指向 `source.csv`、uid 1000。目标清单 `a19bdac1`（31 字节）和恢复前清单 `ba52d77b`（43 字节）都还在。截图：[确认前](w11-stage-d-ui-retry-blocked-2026-10-02.png)、[修复后](w11-stage-d-ui-retry-done-2026-10-02.png)。「回到恢复前」、归档、清理、取消归档仍只引用 [此前证据](w11-stage-d-ui-repair-2026-10-02.md)，本轮没有重做。

**超限保护降级。** 项目 `8e2a5d4d-83b8-443a-9262-b1327e600d02`，稀疏文件 `large.bin` 表观 525336576 字节。浏览器在项目页发送「阶段D保护核对」，会话 `b41c0c90-9228-4ff5-a137-ec4c45960b46`。事件顺序是 run、用户消息、environment preparing、标题、environment 且 `project_file_protection.state=skipped`、environment ready、context、turn、attempt `model_error`、turn、error（正文含 401）、run failed。没有工具事件。时间线在模型拒绝之前显示「项目超过快照上限，本次运行没有快照」。项目页显示「当前运行未受快照保护：项目超过快照上限，本次运行没有快照」，并说明可继续运行或单文件下载，上传和整项目下载仍受大小限制。见 [项目页](w11-stage-d-ui-overlimit-notice-2026-10-02.png) 与 [390 会话](w11-stage-d-ui-390-session-2026-10-02.png)。这是一次真实运行里的保护降级，不是只调用捕获 helper。模型没有成功，不能把这次当成模型时间线通过。

**侧栏占用。** 同一次运行的可访问名称曾是「stage-d-overlimit-20261002 运行中」，保护句已经出现在时间线。随后一帧显示「文件处理中」；该帧同时露出 401 正文，没有入库。修复前，重试项目的可访问名称含「等待修复」。等待审批、等待回复没有出现。

**附件回执。** 对重试项目调用产品 `POST /files` 上传 `receipt-note.txt`（27 字节，sha256 `283a1ef6265b88a2020342687f4591bbc9ed95c3317236f28768892976cbdb7c`），再 `POST /sessions` 与 chat。副本 `attachment:11b91b26-6547-4b7c-9643-665d98220b5a` 为 ready，路径 `uploads/receipt-note.txt`，uid 1000。会话 `e9593208-9f6c-446c-b742-c8f0a666c5ea` 在浏览器显示「已存入项目 · uploads/receipt-note.txt」，见 [回执](w11-stage-d-ui-attachment-receipt-2026-10-02.png)。运行同样在模型处失败。回形针文件选择器没有被工具填入文件；回执来自产品上传接口加上浏览器读回，不是从回形针选中的文件。此后该项目多了一份 58 字节清单 `b9870b0b-73be-40d2-8736-7f7f98786a8a`，31 字节与 43 字节两份清单仍在。

**390×844。** `window.innerWidth` 为 390、`innerHeight` 为 844。在该尺寸打开项目页、空白输入、已有会话和项目菜单，并点击侧栏。测完清除覆盖。2026-10-02 早前的 set/reset 超时不沿用为通过。设备像素比 2 的两张捕获画面纵向重复，已不放入证据；保留的是像素比 1 的单屏。

**整目录上传。** 通过。内置浏览器的 `DOM.setFileInputFiles` 仍被拒绝，本轮没有再调它。改在 `ray_agent/ui` 用主机 Playwright 1.61.1（缓存的 Chromium headless shell 1228）打开 `http://127.0.0.1:8088`，当时 UI 镜像是 `sha256:878347819b56ad3bda5fff3de1d789dbeabdf7805a3dda19c2a9bb92a20a9fc5`。样本目录没有 `package.json`：`readme.txt` 14 字节，`build/generated.txt` 13 字节，`.git/config` 7 字节，虚构 `.env` 17 字节。界面走「从文件夹创建」→「兼容选择」→ 警告「此浏览器会先列出文件夹内全部文件，大型依赖目录可能明显变慢。确认后继续选择文件夹。」→「继续选择文件夹」。`filechooser.setFiles` 传入该目录后，捕获到的 `webkitRelativePath` 为 `stage-d-folder-sample/readme.txt`、`stage-d-folder-sample/build/generated.txt`、`stage-d-folder-sample/.git/config`、`stage-d-folder-sample/.env`。扫描显示将上传 `readme.txt` 14 B 与 `build/generated.txt` 13 B；将排除 `.env`（可能包含密钥或凭据，17 B）和 `.git`（版本库或系统文件，7 B）。未勾选 `.env`。创建项目 `b240254f-c2e8-43e1-8045-5d6543d56460`（stage-d-folder-pw-20261002），批次两项均为已发布，`files_size` 27。树根只有 `readme.txt`（14）和目录 `build`；`build/generated.txt` 为 13。下载哈希与主机源文件一致：`readme.txt` `ca1db41542488933aff0ebb177d39a48b969d94a9abb16858e0c81d11d8905ad`，`build/generated.txt` `45960edc3c59bf0464cb0f656ff22742eb452746bab1b7b13ddcedc8c55c5eb8`。`.env` 与 `.git/config` 下载均为 404，树中没有这两项。`build/` 因旁边没有 `package.json`，按普通资料上传。

## 没有通过、也不能降级的项

**跨对话背景。** 既有项目 `9a10bd1d-580b-44d0-97e7-36f091599357` 的摘要仍是失败，见 [2026-10-01 模型失败](w11-stage-d-memory-model-2026-10-01.json)。本轮没有再请求摘要。不记跨对话阅读通过。

**等待审批、等待回复。** 没有出现。模型请求仍是 401，本轮没有再发摘要或模型请求。不记通过。

**交付副本重试。** 通过，且没有模型、没有补造交付消息。项目 `ec37be7a-ab36-4801-bed8-4231a1f42278`，会话 `74a3b41c-4cd4-47b2-8ae6-7d671196cfc9`。容器内按既有交付脚本路径创建真实沙箱，把 `stage-d-delivery,1\n` 写到 `/tmp/partial.csv`，只把 `_persist` 换成一次 `OSError`，然后调用真实 `deliver`。会话附件可下载，19 字节，sha256 `ea9ba0158dcc0276de506ebbada96abc9c54f11c42d578daef1a6b460d3e1008`。副本 key `delivery:74196e8eab309ff2a893cb782a3fbe34012ecebad140efe3facf3ca94691579c` 保持 pending，错误为「观察注入：项目副本失败」，路径当时为空。事件只有 run、用户消息、environment、run，没有工具事件。浏览器先显示「交付可下载，但未保存到项目：观察注入：项目副本失败」和「重试项目副本」，见 [失败卡](w11-stage-d-ui-delivery-failed-2026-10-02.png)。点击后按钮变为「正在写入」，随后变为「项目副本已保存 · outputs/partial.csv」，重试按钮消失，见 [已保存](w11-stage-d-ui-delivery-saved-2026-10-02.png)。补存后仍是同一个 key，卷上 `outputs/partial.csv` 19 字节、同一哈希、uid 1000。会话事件没有增加，状态仍是 completed。沙箱 `rayagent-sandbox-60d4ad89` 销毁后不在容器列表中；销毁时有一条 Supervisor 连接失败日志，没有挡住这次失败副本。条件见 [JSON](w11-stage-d-delivery-retry-2026-10-02.json)。因为工具消息不会在这条无模型路径里出现，会话页改为直接显示该会话尚未出现在时间线里的真实交付副本。

**冲突与禁止操作。** 覆盖确认沿用 [2026-10-01 上传复验](w11-stage-d-ui-upload-retest-2026-10-01.md) 与总计划第 6 节同日下载记录，本轮没有再走覆盖对话框。运行中的第二次写入 409 沿用 [上传网络](w11-stage-d-upload-network-2026-10-02.md)；本轮超限运行结束太快，没有在占用期间再点一次发送。失败恢复期间的禁止原因已在重试确认前看到。

**旧写入者。** 本轮没有新跑 Docker 停止实验。API 源码与运行镜像相对 [所有权证据](w11-stage-d-ownership-2026-10-01.md) 的后续提交没有在本工作树改动；该证据记录真实 Docker 在下一次文件写入前停止旧写入者。本轮不把那次实验复述成新跑的结果。

## 资源

未清理，供复验：

- `ec37be7a-ab36-4801-bed8-4231a1f42278` 与会话 `74a3b41c-4cd4-47b2-8ae6-7d671196cfc9`，已补存的 `outputs/partial.csv` 保留。创建前记录的范围只含这一项目、这一会话和沙箱 `rayagent-sandbox-60d4ad89`；沙箱已销毁，项目未删。
- `8e2a5d4d-83b8-443a-9262-b1327e600d02` 与会话 `b41c0c90-9228-4ff5-a137-ec4c45960b46`，稀疏 `large.bin` 保留。
- `c6900f0b-1373-4a2b-9f47-7b0845df3735`，会话 `a1c94de1-006d-4548-b922-84b9bfe8666c`（空、pending）与 `e9593208-9f6c-446c-b742-c8f0a666c5ea`，附件副本保留。
- 此前三个项目 `9a10bd1d-580b-44d0-97e7-36f091599357`、`a052fa5e-dcbc-4294-be72-930db218c59c`、`b764877f-1662-4482-80ee-204de6b38f1e` 及凭据保留。
- `b240254f-c2e8-43e1-8045-5d6543d56460`（stage-d-folder-pw-20261002），保留 `readme.txt` 与 `build/generated.txt`。创建前项目列表只有此前六个项目。主机样本在 `/tmp/rayagent-stage-d-folder-pw-20261002/stage-d-folder-sample`，未入库。

审计文件 `audit-2026-09-30-d4a0be0.md` / `.json` 保留，未改内容。
