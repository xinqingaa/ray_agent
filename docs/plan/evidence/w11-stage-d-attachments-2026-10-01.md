# 阶段 D：项目附件受理与持久副本

日期：2026-10-01。产品本地提交 `321e0e991939616a1bfbc930defbe6b39f3c8c7c`，随后启动读回修正见本文件后续记录。无推送，阶段 D/E 未完成。

## 实施事实

项目附件在对象上传时核对当前规则、敏感可选确认、实际大小与哈希，并保存确认元数据。chat 的消息、run 和 `(project_id, attachment_id)` pending 关联同事务受理，HTTP 受理不做磁盘发布、沙箱同步或 Docker 停止。首次后台准备停止旧写入者后，文件锁内分配不覆盖路径、发布附件、登记 ready，再生成运行前快照。等待回复续接与运行中注入在消费模型输入之前完成副本发布；快照锁阻止中途注入污染快照。同 id 复用，不同 id 同名自动改名。

发布后的 ready 约束拒绝先查询关联，明确未提交时仅清理本次同哈希副本；其他结果未知错误保留路径，按实际哈希读回补 ready，不盲删。启动核对保留既有 ready、保留已受理未发布的 pending 与错误；已受理且实际发布匹配的补 ready；没有消息关联的 pending 在持久操作/停止旧写入者保护下清理本次孤儿。只读 file-copies 接口可读结果。

这仍是附件后端链路的阶段 D 实施：交付副本、项目笔记/摘要、UI 附件预检与展示未完成，不把接口实施等同浏览器或真实模型验收。

## 验证条件与结果

- 追加迁移单 head `c3f7a0b42e53`。静态编译和 diff 检查通过。
- 核心/协议回归 273 passed / 34 skipped / 2 warnings，`/tmp/rayagent-attachment-regressions-retest.log`；未配置 PG 的用例跳过，两个既有 Pydantic 警告保留。
- 独立 PostgreSQL 16（专用容器、55439）与真实临时磁盘，Docker/模型替身：定向 46 passed，`/tmp/rayagent-attachments-checkpoint.log`。覆盖实际上传确认、消息/run/关联回滚、发布先于快照、改名、锁等待、结果未知、明确 ready 拒绝和启动孤儿收敛。每个数据库测试重建独立 public。
- 真实部署 API 构建/重建和业务迁移通过，187 个 app/core/alembic Python 文件与容器一致。[实际条件](w11-stage-d-attachments-api-2026-10-01.json)记录完整 SHA/镜像、附件哈希、消息 seq、run 与快照 id。真实 HTTP 上传确认、敏感默认拒绝、实际大小/哈希持久化通过；容器内直接调用真实受理事务与后台准备服务，pending→ready、快照包含、同 id 复用和真实 Docker 旧写入者核对/终态大小收尾通过。没有模型、浏览器或沙箱创建；不得计作完整 W11 或阶段 E 场景。

## 失败与修正

首次新附件测试 3 failed / 3 passed，原因是模块没有导入逐例数据库 fixture，旧测试 schema 缺新列。核对时同时发现上一批上传测试也遗漏该 fixture；上一批上传数字是对专用 PG 共享 schema 的验证，不能描述成逐例重建。修正后新附件+上传+迁移 25 项通过，随后新增故障收敛定向 32/46 项通过。旧快照模块原本有 fixture，仍是逐例重建。

将 fixture 直接引入混合规则/PG 测试文件后，未配置 PG 的全套出现 13 个规则用例 setup error（PG_URI 为 None），260 passed / 32 skipped；改为条件 fixture 后 273 passed / 34 skipped / 2 warnings。失败日志 `/tmp/rayagent-attachments-pg.log`、`/tmp/rayagent-attachment-regressions.log` 保留，复验见对应 retest 日志。不是产品数据库错误，没有触碰用户库 schema 以掩盖失败。

启动已受理的未知结果还需要读回补 ready，因此在 `9bfc117` 增加真实哈希核对，5 个附件 PG 用例复验通过（`/tmp/rayagent-attachments-startup-readback.log`）；修改后重建 API，最终条件追加到 JSON。

## 资源范围与下一步

真实部署只创建一个唯一测试项目、一个会话/run、一个附件及其对象/副本/快照。删除前 JSON 记录全部唯一 id、表和路径，按范围清理并读回项目/会话数量；无其他数据删除。独立测试 PG 保留。

下一步继续交付持久副本及部分失败补存、项目笔记与摘要、UI 和跨包状态，随后冻结版本与阶段 E 全部真实验收和事实文档。W9/W10/W11 保持进行中，目标 active，无 tag、无推送、无课程修改。
