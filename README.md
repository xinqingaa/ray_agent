# RayAgent

基于 MoocManus 课程项目的学习仓库。当前目标是跑通原项目、升级 A2A/MCP、系统理解实现；完成学习后再考虑二开。

课程来源：[慕课多智能体 MoocManus](https://coding.imooc.com/class/chapter/955.html#Anchor)。原作者信息和课程代码保留在各子目录中。

## 目录

| 路径 | 内容 |
|---|---|
| [ray_agent/](ray_agent/README.md) | 原 `mooc-manus/` 全栈产品，内部结构保留 |
| [labs/](labs/README.md) | 课程练习，保留各自的依赖环境 |
| [lessons/](lessons/README.md) | 英文教学文档入口，后续系统编写 |
| [archive/](archive/) | 历史聊天和设计地址，纳入 Git 便于跨设备同步 |
| [PLAN.md](PLAN.md) | 当前计划、阶段完成标准和下一步 |
| [AGENTS.md](AGENTS.md) | 仓库协作约束 |

Git 根目录是当前工作目录；其中的 `ray_agent/` 是产品子目录。运行产品时需要进入这一层。

## 产品启动入口

先阅读 [产品 README](ray_agent/README.md)，在 `ray_agent/` 下准备本地 `.env`，并配置 `ray_agent/api/config.yaml`。API 配置字段可参考 [API 环境示例](ray_agent/api/.env.example)，Compose 内的服务地址和端口需要与实际部署核对。

```bash
cd ray_agent
docker compose up -d --build
```

网关默认地址为 `http://localhost:8088`。启动命令继承自课程说明，整理阶段尚未完成运行验证；下一阶段处理启动问题并记录可复现步骤。

不要将实际密钥写入提交。`api/config.yaml` 是已跟踪文件，填写模型密钥后尤其需要检查差异；`.env` 等本地环境文件已忽略。

## 学习顺序

1. 跑通原项目，验证包含工具执行的完整任务。
2. 随即升级 A2A/MCP，逐项验证原有能力。
3. 划分 lessons，以升级后可运行的实现为基准系统学习。
4. 完成学习后再规划二开；框架替换优先级最低。

## 跨设备使用

`archive/`、课程资源和依赖锁文件随仓库提交，本地环境和实际凭据不随仓库同步。另一个设备拉取后需重新准备运行环境与本地配置。

本次初始化只建立本地 Git 历史；跨设备拉取还需要配置远端并推送。
