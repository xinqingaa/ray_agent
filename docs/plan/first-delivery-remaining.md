# 首个交付收尾清单

这里维护首个交付仍需实施、验证或决定的事项。各包状态及整包门槛见[实施工作包](implementation.md)，界面还原标准见[原型落地计划](prototype-ui.md)。

## P5 桌面界面

**待验收**

- 在真实桌面验证工作方式历史分页、恢复旧正文、并发更新和编辑后采纳。覆盖记忆候选目标变化后的重新审阅与确认、钉住过渡和撤销提示，以及「本次参考」按实际版本打开来源和显示不可读原因。文档版本及页／块／单元格定位归 P6。
- 验证带 Skill 和图片的真实发送、已受理的计划失败后打开所属清单、Finder 跨窗口拖到两个落点及拖入反馈、竖图显示、原生文件夹选择与文件撤销确认。构造首页交付列表和文件预览读取失败，验证恢复，并用长列表观察滚动和切换是否明显变慢。
- 集中核对原型细节、窄窗口与移动视口、键盘焦点和减少动态效果。运行步骤见[运行检查](../../ray_agent/README.md#运行检查)。

**待实现或定规则**

- 会话成果列表后台刷新失败目前缺少就地提示和重试。完成条件是保留已有结果、明确显示刷新失败并允许重新读取。
- 已确认需要让已受理的计划在执行失败后继续，当前可查看清单。续接步骤、已完成工作和副作用的处理、重新审批边界需先确认。工作区首页跨会话成果聚合已暂缓。

## P6 全文知识

### F04 文档解析重启后卡死：已复现，待修复（P6）

- [ ] **偏差与问题**：原目标要求取消、崩溃和发布窗口可恢复。revision 停在 `PARSING`／`INDEXING` 时，通用任务恢复只重排 job；处理循环只取 `PENDING_PARSE`，相同文件再次同步又跳过旧状态。持久 SQLite 复现中任务被记成功、处理数为零，文档仍在解析且不可检索。
- **位置**：[document_index_service.py](../../ray_agent/api/app/application/services/document_index_service.py) 的 `_ensure_job`、`process_workspace`、`sync_workspace`、`_parse_and_publish`；恢复协作在 [document_index_scheduler.py](../../ray_agent/api/app/application/services/document_index_scheduler.py)、[background_jobs.py](../../ray_agent/api/app/application/services/background_jobs.py) 与 [db_document_repository.py](../../ray_agent/api/app/infrastructure/repositories/db_document_repository.py)。
- **关闭条件**：在解析中、暂存后和发布前分别中断并重启，能恢复或明确失败；取消后可重试，半份结果不发布，更新／删除后旧任务不能复活旧版本。

### F10 文档来源版本与定位

文档来源需按保存的版本定位页、块或单元格。当前读取仍已发布的片段，修改、删除或撤权后旧来源的可读边界待验证。完成条件是按来源身份定位，材料变化后明确显示过期或不可读，并验证授权与删除边界。实现与检查入口见[代码地图](../code-map.md#上下文与记忆)。

## P6／P7 索引控制

### F11 索引管理界面未闭环：静态确认缺口（P6／P7）

- [ ] **偏差与问题**：原目标要求用户理解规模、控制索引范围并处理资源压力。当前文件夹面板只有索引汇总，缺少范围排除、暂停／关闭及清楚的失败重试入口；语义就绪状态也未展示，不能让用户区分全文可用与语义可用。
- **位置**：[folder-panel.tsx](../../ray_agent/ui/src/components/workspace/folder-panel.tsx)、[working-style-settings.tsx](../../ray_agent/ui/src/components/workspace/working-style-settings.tsx)、[documents.ts](../../ray_agent/ui/src/lib/api/documents.ts)；后端沿文档索引与语义索引服务核对可控状态。
- **关闭条件**：大文件夹先说明范围与规模，范围选择和暂停能实际影响后台任务；进度、全文／语义可用性、错误与重试均有对应后端行为。

## P7 语义检索与 OCR

### F02 固定版本向量读取失败：已复现，待修复（P7）

- [ ] **偏差与问题**：原目标要求按已发布版本语义召回。`open_at_version` 返回 `table.checkout(version)`，锁定 LanceDB 的该方法原地切换并返回空值，随后查询异常被吞成空结果。同一向量读最新版本可命中，按发布版本读取却不命中，表面仍可依靠全文结果工作。
- **位置**：[lancedb_store.py](../../ray_agent/api/app/infrastructure/external/vector_store/lancedb_store.py) 的 `open_at_version`、`search`；调用方 [retrieval_service.py](../../ray_agent/api/app/application/services/retrieval_service.py)；[test_semantic_ocr.py](../../ray_agent/api/tests/core/test_semantic_ocr.py) 中已有全文可命中的混合召回检查不能证明向量分支有效。
- **关闭条件**：用真实 LanceDB 检查“全文不命中、向量应命中”，覆盖固定发布版本、重建代次与删除撤回，避免异常静默掩盖语义不可用。

### F03 长文本语义输入丢内容：已复现，待修复（P7）

- [ ] **偏差与问题**：原目标不允许只截断输入却声称整段已入库。用于估算长度的 tokenizer 已启用截断；切分再截掉超预算 token，却按完整字符窗口向前推进。使用真实 tokenizers 的合成词表复现了中段词丢失，后续向量均值不能补回这些内容。
- **位置**：[e5_onnx.py](../../ray_agent/api/app/infrastructure/external/embedding/e5_onnx.py) 的 `load`、`split_by_token_budget`、`passage_parts`；[semantic_index_service.py](../../ray_agent/api/app/application/services/semantic_index_service.py) 的分段编码与合并。
- **关闭条件**：长度测量不受截断影响，每段计入前缀和特殊 token；长中文、长表及中尾部标记均完整进入编码，任意超额部分都能继续处理。

## P8 Skill

### F01 Skill 工作区范围：已补修，待定向确认（P8）

- [ ] **偏差与问题**：原目标要求工作区私有内容不串用。评估中先发现 A 的私有 Skill 后，B 与独立对话都可绑定并加载其正文。当前已增加范围过滤、工作区身份和受理冻结，不能继续按旧实现判定，也不能仅凭补修即记通过。
- **位置**：[skill_service.py](../../ray_agent/api/app/application/services/skill_service.py) 的 `_in_scope`、`_members`、`_freeze_bound`、`accept`、`bind_run`；[skill_discovery.py](../../ray_agent/api/app/domain/services/skill_discovery.py) 的来源工作区身份。现有多来源检查入口：[test_skill_multi_source.py](../../ray_agent/api/tests/core/test_skill_multi_source.py)。
- **关闭条件**：确认自动目录、受理冻结、显式选择、正文与资源读取、等待续接均遵守工作区范围和快照版本；另一工作区和独立对话不能借旧登记或显式选择绕过。

### F13 Skill 设置检查入口

Skill 设置检查的替身加载器在加载 `@tauri-apps/api/core` 时失败。修复后运行检查并确认交互断言实际执行。入口见 [UI 开发指南](../../ray_agent/ui/README.md#检查与构建)。

## P9 Mac 闭环

### F12 内部包整体验收

在完整内部包验证真实模型跨会话使用材料和记忆、脚本、组件与浏览器、停止退出、覆盖安装和数据保留，并在没有开发环境的 Apple Silicon Mac 重复。完整包已有本机组件与真实模型短任务的验证记录。全部场景按[首个交付门槛](implementation.md#交付检查口径首个交付)关闭。
