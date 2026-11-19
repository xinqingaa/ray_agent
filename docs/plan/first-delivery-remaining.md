# 首个交付收尾清单

这里维护首个交付仍需实施、验证或决定的事项。各包状态及整包门槛见[实施工作包](implementation.md)，界面还原标准见[原型落地计划](prototype-ui.md)。

## 桌面通用待办

- 会话成果列表后台刷新失败目前缺少就地提示和重试。完成条件是保留已有结果、明确显示刷新失败并允许重新读取。
- 已确认需要让已受理的计划在执行失败后继续，当前可查看清单。续接步骤、已完成工作和副作用的处理、重新审批边界需先确认。工作区首页跨会话成果聚合已暂缓。

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

整包桌面回归覆盖带 Skill 和图片发送、计划失败后查看所属清单、Finder 跨窗口拖入、竖图预览、原生选择器、撤销确认，以及成果和文件预览的错误恢复。用长列表检查滚动和切换，并核对窄窗口、键盘焦点和减少动态效果。操作入口见[运行检查](../../ray_agent/README.md#运行检查)。
