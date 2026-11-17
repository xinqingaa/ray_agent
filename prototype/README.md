# RayAgent 原型

当前评审入口是 [V5 交互原型](v5/index.html)，设计规则与试用路径见 [V5 说明](v5/README.md)。设计思路与风格见 [V5 设计说明](v5/DESIGN.md)。

| 版本 | 用途 |
|---|---|
| [V5](v5/index.html) | 当前交互评审；全部页面：对话、背景、知识、Skill、运行组件、设置与各对话框 |
| [V4](v4/index.html) | 此前工作区评审；统一添加工作区、四视图、文件图标与 P5–P8 操作路径 |
| [V3](v3/index.html) | 此前整合探索，供对比工作区概览和信息组织 |
| [V2](v2/index.html) | 纸面风格探索，供对比结构 |
| [V1](ui/index.html) | 最接近现有产品 UI，作为视觉与简短执行过程的参考 |

在仓库根目录运行：

```bash
python3 -m http.server 4177 --bind 127.0.0.1 --directory prototype
```

打开 [V5 工作区对话](http://127.0.0.1:4177/v5/index.html#/ws/review/s1)。左下角评审条可切换运行状态、模拟拖入文件与深浅色。

所有版本都是独立静态原型，不连接真实文件系统、索引、模型或执行器。现有 Skill 管理库不等同于 P8 的多来源、范围与版本能力。原型不改变 `docs/plan` 实施状态或 `ray_agent/ui`。
