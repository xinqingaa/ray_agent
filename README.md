# RayAgent

RayAgent 是一个具备任务规划、工具调用和沙箱执行能力的 AI Agent 应用。用户通过 Web 界面发起任务，Agent 将目标拆解为步骤，在执行过程中调用工具、更新计划，并将进度和结果实时返回界面。

## 功能

- **任务规划与执行**：自研 Plan + ReAct 流程，结合任务分解与多轮工具调用。
- **沙箱工具**：在隔离容器中执行命令、读写文件和操作浏览器。
- **外部能力接入**：通过 MCP 调用工具，通过 A2A 调用远程 Agent。
- **实时交互**：展示任务计划、执行事件和工具结果，支持沙箱浏览器画面查看。
- **会话与文件**：保存会话数据，管理附件与执行产物。

## 架构

```text
Web UI（Next.js）
    │ HTTP / SSE
    ▼
Nginx → API（FastAPI）
            ├── Plan + ReAct → 内置工具 / MCP / A2A
            ├── 沙箱 → Shell / 文件 / 浏览器
            ├── PostgreSQL → 会话与文件元数据
            ├── Redis → 任务与事件传递
            └── COS → 附件与截图存储
```

## 目录

| 路径 | 内容 |
|---|---|
| [ray_agent/](ray_agent/README.md) | 应用服务、沙箱及部署配置 |
| [labs/](labs/README.md) | LLM、ReAct、MCP、A2A 等独立练习 |
| [lessons/](lessons/README.md) | 按主题组织的教学文档 |
| [archive/](archive/) | 历史参考资料与设计资源 |

## 运行

需要 Docker、Docker Compose、可用的模型服务，以及附件和截图所需的 COS 配置。应用配置与启动步骤见 [运行指南](ray_agent/README.md)。

完成配置后，在仓库根执行：

```bash
cd ray_agent
docker compose up -d --build
```

默认访问地址：[http://localhost:8088](http://localhost:8088)。

运行指南已按配置文件核对，完整部署和任务执行仍待验证。

## 项目文档

- [执行计划](PLAN.md)：阶段任务、完成标准与当前进度。
- [协作规范](AGENTS.md)：修改边界、验证要求和 Git 操作规则。
- [学习入口](lessons/README.md)：主题范围与文档组织方式。
