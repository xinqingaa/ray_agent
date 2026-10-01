# 阶段 D：部署修正与项目文件所有权基础

核对日期：2026-10-01（Asia/Shanghai）。审计基线 `d4a0be0033d177a53e855a9a27ebf70bedf8edfa`；本次产品提交 `203fa083138e4a03415dc90da6e3550b40b60ac8`，未推送。机器可读条件见[同名 JSON](w11-stage-d-ownership-2026-10-01.json)。这是阶段 D 的局部实施证据，不是阶段 D/E 出口或最终冻结证据。

## 部署修正

保留原有总计划改动、审计文件与全部凭据，仅将产品未跟踪 `.env` 的 `FILE_STORAGE_LOCAL_DIR` 从 `/data/files/phase4-20260920` 改为 `/data/files` 并重新创建 API。Compose 卷目标仍为 `/data/files`，未移动、删除原文件目录。

真实 `POST /api/projects` 返回 200，新项目 `fe24e243-2852-4044-8eb3-3f7df80f5ac3` 名称为 `stage-d-deployment-check-20261001`，available=true；没有创建 session/run/沙箱。托管挂载脚本确认命名卷 `ray_agent_file_data` 子路径、ubuntu 改删文件、沙箱看不到快照目录，测试目录与沙箱已清理。健康接口与新建项目检查分别记录，不用健康替代业务可用。

最初手工数据库探针连入 Compose 默认 `manus` 库，报迁移表不存在；改用 API 实际配置连接后确认原迁移为 `f9c2a7b4d110`。这不是业务库损坏。由于该迁移已经实际执行，本次追加单 head `a1d4e8f20c31`，保留原迁移和业务记录，不按子计划的旧历史前提重写已执行版本。新镜像启动后产品库已到新 head。

## 本次代码事实

- `projects.file_operation` 保存 operation_id、类型、状态、阶段、run/session 归属、目标/恢复前快照引用、起始/活动时间、结果与错误；项目审计事件独立表、按项目 seq 持久化。操作结束只允许匹配 operation_id 的回调释放，失败与更新同事务入审计。
- 运行终态与 settling 在同一事务提交；新 run、归档/恢复检查持久占用。项目详情/列表携带文件操作及阻止原因，409 带操作和修复动作；新增审计读取与环境收尾重试接口。
- 单进程启动线程/运行器分别登记写入者 token。迟到创建退出、清理核对之前不释放占用；正常、失败、取消终态停止整个项目容器，而非只杀已登记 Shell。
- Docker 正常停止期限 10 秒，仍运行时强制终止，最终用 inspect 的 `State.Running` 核对；不存在算停止。新容器写入 project/session/run 三种标签。
- API 启动先中断遗留 running/approval，再核对项目容器；waiting 提问对应容器保留，只停止同项目其他容器。Docker 核对失败保存 failed settling，阻止写入和续接；重试成功才释放。

上传、附件/交付持久副本、内容快照、恢复、大小/保留/回收、笔记/摘要、完整 UI 尚待后续实施。本次尚没有公开上传批次，通用 claim 仅是后续链路的事务入口；不能据此声称上传/恢复故障已验收。遗留 snapshot/upload/restore/cleanup 的启动收敛须随实际链路补齐。

## 检查与失败复验

| 证据类型 | 结果 | 条件与范围 |
|---|---|---|
| 静态 | 单迁移 head，diff check 通过；API 176 个 Python 文件逐文件哈希与运行容器一致 | app/core/alembic；不包括 UI bundle 同一性 |
| 替身核心/协议 | 244 passed、16 skipped、2 warnings，26.97 秒 | 第 4/5 项新 PG 与 waiting 启动核对补充之前的全量；不宣称替身是真实模型 |
| 最终定向、真实 PG + 替身 | 39 passed，5.27 秒 | 独立 PG 16；run_events、w11_projects、project_operations、pending_start、Docker 参数替身、取消和执行控制；PG 中 Docker 用受控替身 |
| 真实 PG 的新增行为 | 5 项通过，计入上述 39 项 | 跨请求并发、旧回调、事务回滚、终态占用、Docker 不可达、取消 IO 不提前放行、waiting 保留、迟到创建、启动核对失败与续接 |
| 真实 Docker | 通过 | 真正后台进程的标记先增长；指定 waiting 容器保留；其他项目写入者停止；全部停止后文件不再增长，改写后字节不被旧进程覆盖；标签与清理核对 |
| 真实浏览器、模型 | 未执行 | 阶段 E 仍待完整冻结版本验收 |

真实 Docker 第一次失败是新函数误用 `DockerClient` 上下文管理器，已改显式 close。第二次失败是自动移除容器短暂处于 removing，按状态名误判仍运行并 kill 得到 409；改为 `State.Running` 并在停止/移除交叉时读回。两次均清理本次资源；最后一次完整检查通过。失败没有被删除或称为通过。

运行 API 镜像标识 `sha256:d460e0728ee1c571fc1098df99ac94c875feeaa6d62c4466ecd87cdf05ab790d`；UI `sha256:4908d14d8214c64638f371680c89bde64416731d0378014f35aae711cd38b789`；测试使用沙箱镜像 ID `sha256:cc0105ee3b36826d67005b231858e0f5cc814d0efda742529e51d78085049faf`。API/UI/数据库/Redis healthy，网关运行并发布 `127.0.0.1:8088`。本次没有重建 UI/沙箱代码。

## 本次测试资源与清理范围

允许清理范围严格限定本次资源：上述 deployment-check 项目行、该项目审计事件及 `projects/fe24e243-2852-4044-8eb3-3f7df80f5ac3/`；删除前核对名称与没有会话。真实挂载与 writer-check 的唯一临时目录/容器由脚本 finally 清理；不触碰其他项目、会话、旧目录与文件。独立 PostgreSQL 容器 `rayagent-stage-d-pg-20261001`（127.0.0.1:55439）专用于本阶段自动测试，保留供后续阶段 D 复用；每条 PG 测试重建它的 public schema，未指向业务库。

本次 deployment-check 项目按上述限定 id/名称与零会话断言清理完成；清理后业务 projects/sessions/runs 均为 0。未删除文件卷或原存储子目录。

## 统一文件 IO 后续实施

产品提交 `abaff8bad86ad3c3da8222ae89c9895ef53a9a12`（未推送）。新增共用目录描述符遍历、普通文件打开、逐字节 SHA-256/大小统计和原子写入，目录树与预览已复用。发布前核对实际大小/哈希，临时文件 flush/fsync，父目录 fsync；排他发布不覆盖已有文件。覆盖发布仅是基础设施能力，尚未公开上传覆盖入口，后续服务必须先完成保护快照。上传、附件、交付、快照/恢复/下载仍待接入，不能把该基础函数称为完整上传。

本地临时磁盘与文件既有检查共 **19 passed，0.03 秒**：包括链接父目录拒绝、链接不读取目标、FIFO 不阻塞、流读取失败/哈希错误/超限不发布半文件、排他/覆盖写入、相同长度并恢复 mtime 后仍读取全部内容得到不同哈希、NFC 路径，以及文本/二进制/大文件/目录树回归。该数字不是 PG 或真实模型。

API 重建后真实托管挂载脚本改用统一发布函数，在根目录和新建父目录两处写入；ubuntu 均可改删，快照目录仍不可见。项目 `mount-check-6e2fbc96daf743afa1f85fc6c36dc908` 和容器 `rayagent-sandbox-83a709bd` 已清理。最新 API 镜像 `sha256:847aa06d77dc1c3d68bab9444d6a7a1f5f0b7b68b5529e727a47341e2059ad4e`；177 个 app/core/alembic Python 文件与容器哈希一致。迁移不变，UI/沙箱镜像不变；先前 39 项对应所有权提交，19 项及这次真实 Docker 对应文件 IO 提交，尚未最终冻结。
