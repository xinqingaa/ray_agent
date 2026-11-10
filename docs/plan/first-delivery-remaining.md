# 首个交付收尾与接手清单

首个交付处于**实施中**。主要技术方向、Mac 优先顺序与模块划分符合开工前确认的计划，但“主要模块已接入”不等于“工作包完成”：P5—P9 仍有正确性、用户入口与整包验收缺口。状态见[实施工作包](implementation.md#实施状态)，产品边界见[决策清单](decisions.md)。本页只保留当前仍需实施或验证的缺口；组件安装、冻结 worker 与工具运行时的现行机制见执行说明和服务指南。

本页是活动收尾计划，不是永久评估报告。各条分别标明静态确认、历史复现与当前运行复现；未重做全部模块的运行验证。P5 服务层的状态转换有真实 SQLite 与确定性模型回归；源码核心还完成了真实模型跨会话、重启、更正与隔离短任务，仍不代表任意任务的提炼质量或桌面界面已验收。Skill 已有后续补修，单独标注。语义、解析与引用等历史复现使用开发机依赖；执行链已有完整内部包的真实模型、组件与进程检查，仍不能代替跨模块闭环或无开发环境 Mac 的整包验收。临时脚本与历史测试数量不作为接手依赖。

## 与最初规划的主要出入

| 原计划要求 | 当前出入 | 对应清单 |
|---|---|---|
| 每包同时交付实现、调用方、界面和行为检查 | 来源与索引界面仍未闭环 | F10、F11 |
| 隔离、来源版本、取消与重启是完成条件 | Skill 曾跨工作区串用；固定版本向量读取、文本完整性与解析恢复存在失败窗口 | F01—F04 |
| “本次参考”可理解并定位实际采用的背景 | 加载状态卡住，且来源跳转未完成 | F05、F10 |
| P9 在无开发环境的 Mac 上完成真实闭环后再收缩计划 | 必需验证未完成，浏览器被降为可选补强，首个交付计划却已清理 | F12—F14 |

签名公证与自动更新、Windows、辅助移动端在实施前已明确留给 P10—P12，不属于漏做；P8 先于 P6／P7 推进也符合原并行依赖。问题主要在执行完整性和关闭口径，不能通过缩小原完成条件解决。

## 发现与关闭条件

### F01 Skill 工作区范围：已补修，待定向确认（P8）

- [ ] **偏差与问题**：原目标要求工作区私有内容不串用。评估中先发现 A 的私有 Skill 后，B 与独立对话都可绑定并加载其正文。当前已增加范围过滤、工作区身份和受理冻结，不能继续按旧实现判定，也不能仅凭补修即记通过。
- **位置**：[skill_service.py](../../ray_agent/api/app/application/services/skill_service.py) 的 `_in_scope`、`_members`、`_freeze_bound`、`accept`、`bind_run`；[skill_discovery.py](../../ray_agent/api/app/domain/services/skill_discovery.py) 的来源工作区身份。现有多来源检查入口：[test_skill_multi_source.py](../../ray_agent/api/tests/core/test_skill_multi_source.py)。
- **关闭条件**：确认自动目录、受理冻结、显式选择、正文与资源读取、等待续接均遵守工作区范围和快照版本；另一工作区和独立对话不能借旧登记或显式选择绕过。

### F02 固定版本向量读取失败：已复现，待修复（P7）

- [ ] **偏差与问题**：原目标要求按已发布版本语义召回。`open_at_version` 返回 `table.checkout(version)`，锁定 LanceDB 的该方法原地切换并返回空值，随后查询异常被吞成空结果。同一向量读最新版本可命中，按发布版本读取却不命中，表面仍可依靠全文结果工作。
- **位置**：[lancedb_store.py](../../ray_agent/api/app/infrastructure/external/vector_store/lancedb_store.py) 的 `open_at_version`、`search`；调用方 [retrieval_service.py](../../ray_agent/api/app/application/services/retrieval_service.py)；[test_semantic_ocr.py](../../ray_agent/api/tests/core/test_semantic_ocr.py) 中已有全文可命中的混合召回检查不能证明向量分支有效。
- **关闭条件**：用真实 LanceDB 检查“全文不命中、向量应命中”，覆盖固定发布版本、重建代次与删除撤回，避免异常静默掩盖语义不可用。

### F03 长文本语义输入丢内容：已复现，待修复（P7）

- [ ] **偏差与问题**：原目标不允许只截断输入却声称整段已入库。用于估算长度的 tokenizer 已启用截断；切分再截掉超预算 token，却按完整字符窗口向前推进。使用真实 tokenizers 的合成词表复现了中段词丢失，后续向量均值不能补回这些内容。
- **位置**：[e5_onnx.py](../../ray_agent/api/app/infrastructure/external/embedding/e5_onnx.py) 的 `load`、`split_by_token_budget`、`passage_parts`；[semantic_index_service.py](../../ray_agent/api/app/application/services/semantic_index_service.py) 的分段编码与合并。
- **关闭条件**：长度测量不受截断影响，每段计入前缀和特殊 token；长中文、长表及中尾部标记均完整进入编码，任意超额部分都能继续处理。

### F04 文档解析重启后卡死：已复现，待修复（P6）

- [ ] **偏差与问题**：原目标要求取消、崩溃和发布窗口可恢复。revision 停在 `PARSING`／`INDEXING` 时，通用任务恢复只重排 job；处理循环只取 `PENDING_PARSE`，相同文件再次同步又跳过旧状态。持久 SQLite 复现中任务被记成功、处理数为零，文档仍在解析且不可检索。
- **位置**：[document_index_service.py](../../ray_agent/api/app/application/services/document_index_service.py) 的 `_ensure_job`、`process_workspace`、`sync_workspace`、`_parse_and_publish`；恢复协作在 [document_index_scheduler.py](../../ray_agent/api/app/application/services/document_index_scheduler.py)、[background_jobs.py](../../ray_agent/api/app/application/services/background_jobs.py) 与 [db_document_repository.py](../../ray_agent/api/app/infrastructure/repositories/db_document_repository.py)。
- **关闭条件**：在解析中、暂存后和发布前分别中断并重启，能恢复或明确失败；取消后可重试，半份结果不发布，更新／删除后旧任务不能复活旧版本。

### F05 “本次参考”持续加载：已复现，待修复（P5）

- [ ] **偏差与问题**：原目标要求用户能看到实际采用的背景。effect 把 `loading` 放入依赖，又在 effect 内设置它，重渲染触发清理并将请求标为取消；正常响应也被忽略，界面一直“正在读取”。实际组件配合延迟响应已复现。
- **位置**：[run-references.tsx](../../ray_agent/ui/src/components/run/run-references.tsx) 的清单加载 effect。
- **关闭条件**：成功、失败、切换运行、收起再展开均可结束加载；迟到响应不写入另一运行，失败可重试。

### F10 采用来源不能完整定位：静态确认界面缺口，旧版本语义待核查（P5／P6）

- [ ] **偏差与问题**：原目标要求从引用定位原会话或文件版本、页／块／单元格。当前“本次参考”只显示文字，未提供来源跳转；来源接口只读取仍已发布的片段，修改、删除或撤权后的旧依据可读边界还需核查，不能把这一部分写成已复现缺陷。
- **位置**：[run-references.tsx](../../ray_agent/ui/src/components/run/run-references.tsx)、[document_routes.py](../../ray_agent/api/app/interfaces/endpoints/document_routes.py)、[document_index_service.py](../../ray_agent/api/app/application/services/document_index_service.py) 的 `get_chunk_source`。
- **关闭条件**：按保存的来源身份和版本定位；材料变化后明确显示过期／不可读，遵守删除与授权边界，不猜测成当前原文。P5 还须展示记忆来源版本、候选与当前目标差异，目标变化后由用户重新审阅并明确确认所见版本，不自动重试覆盖；撤销入口须区分支持的操作与旧状态不足、确认及替代等不可单条撤销的情况。

### F11 索引管理界面未闭环：静态确认缺口（P6／P7）

- [ ] **偏差与问题**：原目标要求用户理解规模、控制索引范围并处理资源压力。当前文件夹面板只有索引汇总，缺少范围排除、暂停／关闭及清楚的失败重试入口；语义就绪状态也未展示，不能让用户区分全文可用与语义可用。
- **位置**：[folder-panel.tsx](../../ray_agent/ui/src/components/workspace/folder-panel.tsx)、[working-style-settings.tsx](../../ray_agent/ui/src/components/workspace/working-style-settings.tsx)、[documents.ts](../../ray_agent/ui/src/lib/api/documents.ts)；后端沿文档索引与语义索引服务核对可控状态。
- **关闭条件**：大文件夹先说明范围与规模，范围选择和暂停能实际影响后台任务；进度、全文／语义可用性、错误与重试均有对应后端行为。

### F12 P9 必需验收未完成（P9）

- [ ] **未闭环项**：完整内部包已支持仅系统 PATH 下的组件安装、取消／重试与重启读回，真实模型能够加载 Skill 并执行 Python／Node 和浏览器短任务，停止及核心强杀按子树确认收尾。源码核心已完成真实模型记忆服务短任务；跨会话文件材料、全部桌面工作区交互与无开发环境 Mac 的整包验收仍未完成，不能据短任务或打包成功判定首个交付通过。
- **位置**：[实施状态与交付检查](implementation.md)、[内部包构建](../../ray_agent/desktop/README.md#构建内部包apple-silicon)、[运行检查](../../ray_agent/README.md#运行检查)。
- **关闭条件**：修完前置缺口，在完整内部包上完成真实模型跨会话、文件与脚本、组件／浏览器、停止退出、覆盖安装和数据保留；在无开发环境 Mac 重复。缺条件时保留未验收状态，不下放为可选项。

### F13 检查入口未全部通过：评估已发现，修复后重跑（P9）

- [ ] **偏差与问题**：原目标要求可重复检查。UI lint 的未使用参数错误已清除，仍有既有 effect 依赖警告；Skill 设置脚本在加载 `@tauri-apps/api/core` 时失败，未执行到其声称覆盖的交互。其他服务回归通过也不能覆盖前述失败窗口。
- **位置**：[session-detail-view.tsx](../../ray_agent/ui/src/components/session-detail-view.tsx) 的 effect、[check-skills-settings.cjs](../../ray_agent/ui/scripts/check-skills-settings.cjs) 的替身加载器；检查入口见[UI 指南](../../ray_agent/ui/README.md#检查与构建)。
- **关闭条件**：先按当前源码复核结果，修复 lint 与加载器，再实际执行对应断言；对新修复增加覆盖失败条件的定向检查，不以构建成功替代交互。

### F14 正文与检查依据不一致：静态确认缺口（P9）

- [ ] **偏差与问题**：原目标是将有效设计合入正文。Harness 仍称语义检索与 OCR 留给后续工作包，相关正文与当前已接入但存在正确性缺口的实现不一致。清理计划不等于文档合并完成。
- **位置**：[Harness](../harness.md) 的工作区上下文说明及相关语义、OCR 的能力与检查边界。
- **关闭条件**：沿当前源码替换失效检查入口，统一能力与未闭环边界；正文、指南、类型及链接检查通过后，才清理已完成计划。

## 新 agent 接手顺序

1. 先读 [AGENTS.md](../../AGENTS.md)、[根计划](../../PLAN.md)、本页与[实施条件](implementation.md#交付检查口径首个交付)，再按需读 [API](../../ray_agent/api/README.md)、[UI](../../ray_agent/ui/README.md)、[桌面](../../ray_agent/desktop/README.md)和[契约](../../ray_agent/contracts/README.md)指南。核对工作区改动和当前源码，先分清历史复现、后续补修与仍未验证的项。
2. 在接续实施任务的授权范围内处理对应工作包。P5 继续 F05、F10 的界面与候选重新审阅，服务规则以 Harness 正文为准；P8 确认 F01 的隔离补修，P6／P7 处理 F02—F04 的向量、文本完整性与持久恢复。使用真实存储与真实状态转换构造失败条件；不要用全文命中证明向量成功，也不要只在同一进程内模拟重启。
3. 完成 F05、F10、F11 的加载、来源与索引控制，沿既有层次修改调用方；涉及 HTTP、事件或握手契约时按契约指南重新生成类型，不手改生成文件。索引状态必须反映真实能力和后台任务。
4. 处理 F13、F14，并按各项关闭条件做定向验证，然后补 F12 的真实模型、冻结整包与干净 Mac 验收。所需机器或模型未具备时报告具体依赖；P10 证书不是当前修复的前置条件，也不据此启动 P10—P12。
5. 每关闭一项，同时交付实现、调用方、涉及的界面、定向验证和对应正文更新；在交付说明中报告条件、结果及未测范围。本页替换当前状态，不追加轮次日志；问题全部关闭并达到 P9 门槛后，将有效设计合入正文并删除本清单及入口。
