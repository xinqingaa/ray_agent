# RayAgent 实验与练习

通过独立示例理解模型调用、Agent 执行、工具协议和浏览器操作，并与产品实现对照。

## 内容

| 目录 | 主题 |
|---|---|
| [foundations/](foundations/README.md) | LLM API、结构化输出、工具调用、ReAct、异步 HTTP、MCP 和浏览器 |
| [a2a/](a2a/README.md) | A2A SDK 服务端、SDK 客户端和手写 HTTP 客户端 |

`foundations/2-2 code/weather/` 提供天气 Agent 示例，`foundations/2-2 code/ui/` 提供配套交互界面。

## 运行方式

1. 选择要运行的示例，阅读所属目录的 README 和脚本入口。
2. 确认依赖文件所在位置，在对应目录准备环境。
3. 配置示例需要的模型或外部服务，运行并观察请求和结果。
4. 按教学文档定位相关产品代码，比较示例与完整流程。

`foundations/`、`a2a/`、`foundations/demo-code/` 及 `foundations/2-2 code/` 下的两个项目分别包含依赖文件。运行时使用对应项目的环境，并保留资源文件所需的相对路径。

这些练习既包含客户端也包含服务端；使用前确认示例的角色、端口和服务依赖。

## 文档入口

- [教学文档](../lessons/README.md)：学习主题、示例与产品代码的关联。
- [产品运行指南](../ray_agent/README.md)：完整应用的部署和验证。
