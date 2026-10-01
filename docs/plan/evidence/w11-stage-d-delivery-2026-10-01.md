# 阶段 D：交付持久副本与失败补存

核对日期：2026-10-01。产品提交 `9317b739b140b9b19f2e8f1c3d66bb68c6851578`，真实观察入口和路径引用修正后 `25216bfd88f33667129dfddc5ad51593015d1ab8`。本地提交，无推送；不是阶段 E 冻结版本。

## 实施事实

项目交付保留原会话附件，并分别返回项目状态。工作区内文件不再复制；沙箱检查返回真实解析路径和普通文件类型，`/workspace-other` 以及工作区内指向外部的链接都按外部文件处理，复制到 outputs，名称自动分配。项目副本由统一文件 IO 原子发布，大小缓存随后更新；Agent 产出复制不套用用户上传的文件配额。

交付关联保存 run、call_id、源路径、解析路径、会话附件 id、内容哈希与项目路径。相同调用补存复用已有附件，项目复制失败仍可下载会话附件，工具返回部分失败，交付消息和事件附件携带项目状态。闲置项目的补存入口具有持久 delivery 操作，停止旧写入者后只重试该副本，不需要沙箱、不重新交付。运行中复制由运行器 writer 所有权和同一文件锁保护，取消等待线程实际退出与 ready 提交后再放行收尾。

同名项目附件同步到沙箱使用已经分配的文件名，避免 `/home/ubuntu/upload` 覆盖；同步源流成功或失败后关闭。会话文件替换的 PostgreSQL 锁限定 sessions，不锁外连接的 nullable 项目侧。

## 验证与条件

- 静态：compileall、diff 检查通过。UI API 类型 `tsc --noEmit` 通过，尚未实施完整 UI 展示/补存入口。
- 核心/协议回归 274 passed / 40 skipped / 2 warnings，`/tmp/rayagent-delivery-regressions.log`，在两个新增定向用例前执行；新增用例随后单独通过。两条既有 Pydantic 警告保留，PG 未配置的测试跳过。
- 最后独立 PostgreSQL/真实临时磁盘定向 46 passed，`/tmp/rayagent-delivery-all-pg.log`（含交付、附件、上传、快照、所有权和迁移）；此前 21 项交付定向通过。Docker/模型是替身。复制线程取消用 gate 核对：终态后 writer 未退出不得 settle，线程发布/ready 完成后才收尾。两个交付投影用例通过，含调用 ID 到达回调、失败工具结果仍产生下载卡、改名与源流关闭。
- 沙箱本地 unittest 3 passed，22.208 秒，`/tmp/rayagent-delivery-sandbox-tests.log`，含实际路径和原 Shell 控制。没有 HTTP、Docker 或模型。
- 真实 API/业务 PostgreSQL/动态 Docker 沙箱通过：[完整条件](w11-stage-d-delivery-api-2026-10-01.json)。等待服务就绪并校验真实挂载后，用沙箱文件 API 创建产物，核对解析路径、工作区引用/外部副本、同调用复用、注入一次项目副本失败、停止写入者与销毁沙箱、无沙箱补存及重复补存。销毁后通过 HTTP 下载全部 7 个历史附件，ZIP 6 个实际路径/字节均正确（两条工作区引用共享一个文件），符号链接未打包，源内容 SHA256 一致。
- 最终 API 190 个 app/core/alembic Python 文件、沙箱 28 个 app Python 文件与镜像哈希一致。运行 head `e5b9c2d64a75`；API/UI/沙箱镜像与完整产品 SHA 见 JSON。忽略配置只更新 SANDBOX_IMAGE 为新 tag，凭据等其他设置保留。没有模型或浏览器操作，不算阶段 E。

## 失败、修正与复验

真实 PG 首轮 13 passed / 1 failed：会话移除旧文件的 `FOR UPDATE` 锁了外连接 nullable 侧，PostgreSQL 拒绝。限定 `of=SessionModel` 后交付/附件/迁移及旧交付 22 项通过；日志 `/tmp/rayagent-delivery-pg.log`、`/tmp/rayagent-delivery-pg-retest.log`。

本地解析路径测试首轮将 macOS 的 `/var` 字面路径与 realpath 的 `/private/var` 比较失败；期望也采用解析路径后通过。不改变产品解析语义。

真实沙箱首轮脚本未等待 Supervisor 就绪，ConnectError；[失败记录](w11-stage-d-delivery-failed-2026-10-01.json)。补上实际服务与挂载核对。第二轮 ubuntu 无权直接创建 `/workspace-other`，脚本只检查请求受理成功，缺失文件在交付时被明确拒绝；[第二轮失败](w11-stage-d-delivery-failed-retry-2026-10-01.json)。改用容器内 sudo 创建/chown 后复验通过。失败轮沙箱均在 finally 销毁，运行终态和重启 interrupted 记录保留到限定测试资源清理前；不把失败轮算通过。

复验准备核对到工作区引用可由不同调用共享同一路径，原副本唯一约束不能直接用于它。追加 `e5b9c2d64a75` 仅对真实发布副本约束路径，保留现有行；同文件跨调用 PG 用例补齐并通过，最终真实多运行项目也覆盖。不能无损降级到旧唯一约束时明确拒绝，不删除用户记录。没有重写已经执行的 d4 迁移。

下载验证最初对 Docker 不存在错误用了大小写敏感断言，实际下载全通过；确认 Docker 返回小写 `no such object` 后更正观察断言并复验。沙箱源哈希核对误用镜像不存在的 python 命令，临时容器自动清理；改为镜像 python3 后 28 文件匹配，不安装依赖。这两项只是验证入口失败，记录保留。

## 资源与剩余范围

唯一测试项目 id `162bcf99-c861-46c4-9c54-08d0be2d56f1`、一个会话、三轮 run、7 个附件/对象、项目副本与快照。清理前 [资源入口](w11-stage-d-delivery-resources-2026-10-01.json) 和最终 JSON 记录所有 id、key、表、目录与三个沙箱；仅按该范围清理，三个沙箱均不存在，其他数据与审计文件保留。独立 PG 留供复用。

下一步项目笔记/摘要，接齐 UI 与跨包状态、补充完整文件故障场景，然后同一冻结版本阶段 E、事实文档与本地验收 tag。W9/W10/W11 保持进行中，目标 active；未标完成、未建 tag、未推送、未改课程。
