# RayAgent 原型

当前评审入口是 [V4 工作区原型](v4/index.html)，交互范围与试用路径见 [V4 说明](v4/README.md)。视觉沿用 V1，重新组织工作区导航、概览、对话、背景、知识与多来源 Skill。

| 版本 | 用途 |
|---|---|
| [V4](v4/index.html) | 当前交互评审；统一添加工作区、四视图、文件图标与 P5–P8 操作路径 |
| [V3](v3/index.html) | 此前整合探索，供对比工作区概览和信息组织 |
| [V2](v2/index.html) | 纸面风格探索，供对比结构 |
| [V1](ui/index.html) | 最接近现有产品 UI，作为视觉与简短执行过程的参考 |

在仓库根目录运行：

```bash
python3 -m http.server 4177 --bind 127.0.0.1 --directory prototype
```

打开 [V4 工作区概览](http://127.0.0.1:4177/v4/index.html#workspace/review)。底部评审条可切换运行、审批、空态、组件与检索等场景。

所有版本都是独立静态原型，不连接真实文件系统、索引、模型或执行器。产品实施截至 P3，后续能力仅表达拟议交互；现有 Skill 管理库不等同于 P8 的多来源、范围与版本能力。原型不改变 `docs/plan` 实施状态或 `ray_agent/ui`。
