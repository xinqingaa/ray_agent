# 维护与优化计划

RayAgent 已完成单循环 Harness、托管项目及随后多轮优化，转入维护。当前机制见 [Harness 工程](../harness.md)和 [架构说明](../architecture.md)，能力与验证边界见 [能力与边界](../capabilities.md)。本入口维护重要阶段结论、关键验收索引和按问题归并的优化方案。已完成方案保留设计、依赖与完成条件，状态明确标注，不自动恢复为待办。

## 阶段结论

| 阶段 | 重要结果 | 定位 |
|---|---|---|
| 旧版教学工程 | Plan + ReAct 双循环，原 16 章验收完成 | `baseline-v1` → `961005d`；课程正文仍在该基线 |
| 单循环 Harness | 一份记忆、计划工具、上下文治理、运行事件、流式、审批及停止 | `v2` → `39d9fb7` 是阶段标记 |
| 托管项目 | 平台文件、快照恢复、占用协调、透明记忆 | 综合验收产品基线 `89aa642` |
| 后续维护 | 按需资源、文本/视觉观察、统一预览、稳定范围与阶段、版本核验、分项成果和有限收尾、模型端点配置；会话主区执行状态、消息文件引用和子步骤维护已完成本地定向与真实任务验收 | 当前整理来源 `b62fda5`；各项实施与验证条件分别记录 |

这些阶段可以收尾，不表示任意复杂任务稳定或全部能力已验证。最新多模型接入有定向与组件检查，没有该轮真实上游或部署验证；长任务有完整交付但业务口径与交互失败，效率也未全面收敛。部署状态不能仅由源码提交或历史健康检查推断。

原工作包、多轮专项和已结束调研按同一问题合并。主体解释当前机制，[演进背景](../background/README.md)解释问题与选择的形成，下面的专题方案保留跨模块设计和实施关系。逐轮日志、重复草案和完全被替代的协议退出正文；未实施或退出范围的目标不自动转为待办。

## 关键验收

| 报告 | 支持的主要判断 |
|---|---|
| [执行、上下文与运行控制](evidence/execution-and-control.md) | 单循环对照、调用配对、低窗口压缩、停止、受理及构建身份；保留基线停止失败 |
| [项目、记忆与文件保护](evidence/projects-and-files.md) | 连续项目、文件保护故障、恢复、旧写入者、上传及数据清理；按版本分开条件 |
| [工具、浏览器、视觉与模型](evidence/tools-and-models.md) | 受控浏览器、像素输入、临时回收、按需资源及模型配置；区分真实上游与替身 |
| [计划、核验与成果交付](evidence/plans-and-delivery.md) | 稳定阶段、分项成果、有限收尾、累计说明及独立产物核验；子步骤维护与交付表达的三次真实回归；保留长任务业务失败 |
| [界面与文件阅读](evidence/interface-and-preview.md) | 统一预览、项目交互、图片输入、计划查看及统计；会话执行状态、历史文件链接与分层清单；区分浏览器、组件与仅构建修订 |

报告是历史证据摘要，不是最新版本全量认证。证据筛选及追溯方法见 [验证资料说明](evidence/README.md)，未验证范围统一维护在能力文档。

## 专题优化方案

下面七份方案均承接已经完成的授权工作。方案中的设计、实施顺序和验收矩阵用于理解成组改造；“完成条件”不代表所有条件都做过真实模型测试，实际结果以各自证据为准。后续继续修改时先核对当前源码及新工作的授权范围。

| 方案 | 核心内容 | 状态 |
|---|---|---|
| [执行循环、上下文与效率](execution-and-context.md) | 单循环、工具管线、结果整形、容量、自动/手动压缩、按需准备和有限读取并发 | 已实施；效率证据有条件限制 |
| [运行生命周期、事件与可靠性](runtime-and-control.md) | 状态身份、事件与流式、受理、等待、停止、构建及提示快照 | 已实施；通用执行恢复未进入范围 |
| [计划可信度、核验与成果收尾](long-task-trust-and-delivery.md) | 稳定阶段、范围来源、版本核验、分项成果、有限收尾与累计说明 | 已实施及有限验收；业务和效率保留失败 |
| [浏览器观察与视觉资源](browser-and-visual-resources.md) | 文本观察、动作/ref、公开网页、像素输入、资源回收与真实视口 | 已实施；真实第三方及视觉质量有空白 |
| [托管项目、文件与记忆](projects-and-data.md) | 平台副本、上传、快照恢复、写入协调、透明记忆及数据清理 | 已实施；多实例与真实 COS 未全面覆盖 |
| [用户交互与文件阅读](interface-and-preview.md) | 项目信息结构、草稿链、预览、图片输入、开发者观察与统计 | 已实施；后续部分修订仅构建/源码检查 |
| [模型目录与端点配置](model-connections-and-selection.md) | 逐模型参数、内部端点映射、请求恢复和简洁选择 | 已实施及定向检查；最新接入未验真实上游/部署 |

## 资料承接关系

2026-10-13 依据 Git `b62fda5` 重组。下表说明原资料的设计内容现在在哪里维护，原路径仅作为历史出处；需要完整原件时使用 `git show b62fda5:<原路径>`。每个专题按问题补回分析与设计，不以文件减少或行数减少作为整理目标。

| 原资料组 | 背景中的承接 | 方案中的承接 |
|---|---|---|
| 原二次开发的循环、上下文和按需环境工作包 | [循环与上下文](../background/execution-and-context.md) | 执行循环、上下文与效率 |
| 原事件、UI 数据投影、流式、控制与受理工作包 | [运行事实与控制](../background/runtime-and-progress.md) | 生命周期与可靠性；投影交互归用户交互方案 |
| 原项目工作区及后续 `project-data-experience.md`、`project-experience.md` | [项目与保护](../background/projects-and-artifacts.md) | 项目、文件与记忆；界面行为归用户交互方案 |
| `session-progress-and-plan.md`、`staged-plan.md` | [长任务计划](../background/plans-and-delivery.md) | 稳定阶段、承接、范围和计划阅读，过渡状态协议舍弃 |
| `run-budget-finalization.md`、`long-task-trust-and-delivery.md` | [长任务交付](../background/plans-and-delivery.md) | 计划可信度、核验与成果收尾 |
| `reliability-and-closeout.md` | [运行事实](../background/runtime-and-progress.md)、[长任务](../background/plans-and-delivery.md)、[工具观察](../background/tools-and-interface.md) | 构建/承接归运行方案，核验/交付归成果方案，视口归浏览器方案 |
| 原界面与输入命令工作包及 `developer-mode.md`、`file-preview.md`、`project-ui-consistency.md`、`home-composer.md`、`session-metrics.md` | [交互与配置](../background/interaction-and-configuration.md) | 用户交互与文件阅读 |
| `model-connections-and-selection.md` 及原逐模型设置调整 | [模型配置](../background/interaction-and-configuration.md#模型接入从猜域名转向明确目录) | 模型目录与端点配置 |
| `docs/research/agent-execution-efficiency-2026-10-08.md`、`browser-screenshot-policy-2026-10-08.md` | [工具观察](../background/tools-and-interface.md)、[执行效率](../background/execution-and-context.md#效率问题为什么后来转向工具契约) | 浏览器与视觉、执行循环与效率 |
| `docs/research/run-budget-and-artifact-finalization-2026-10-10.md`、`project-closeout-review-2026-10-11.md` | [长任务](../background/plans-and-delivery.md)、[运行](../background/runtime-and-progress.md) | 成果收尾、运行可靠性和浏览器视口 |
| 原综合验收与分轮专项报告 | 关键失败保留在对应问题的分析中 | [统一验证资料](evidence/README.md)，设计条件与实际结果分别维护 |

## 新工作与维护方式

用户于 2026-10-13 授权排查计划清单过于通用的问题并制定方案，见[执行计划的任务语义与内容设计](task-specific-planning.md)。已核对两个真实会话及规划机制，目标为执行计划体现主题推导、内容设计，并保留制作与验证。排查与方案已完成；产品实施及真实模型回归尚未授权，不并入已完成的计划机制验收。

当前已授权且实施中的成组工作为 Responses 通信迁移、错误分类、计划面板优化与最近模型偏好，范围见[模型方案](model-connections-and-selection.md#responses-通信与最近选择)及用户交互方案。上述专题是完成方案，不从保留的失败、限制或历史设想自动生成新任务。配图由用户另行组织，课程同步见 [课程同步范围](../course-sync.md)。

日常修复按实际影响修改、验证并替换所属说明。跨模块成组工作按同一问题规划，写清依据、目标、范围、依赖和完成条件；计划本身不授权实施。已有专题在同一问题继续获授权时可更新有效设计和状态，不恢复工作包编号或追加逐轮日志；独立新问题另建方案。

完成后将现行机制合入主体，背景保留诊断与重大转折，方案保留有效设计、责任、依赖和验收条件，证据进入唯一的 `docs/plan/evidence/`。过渡草案和重复材料可退出，不能用“已完成”作为删除整个方案的理由。

根 [PLAN.md](../../PLAN.md) 作为导航入口，阶段结论和关键验收索引只维护在本页。
