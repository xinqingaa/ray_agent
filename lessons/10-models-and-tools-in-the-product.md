# Models and tools in the product

对照 [01](01-model-api.md)～[03](03-tool-calling.md)：产品里模型从哪读配置、工具如何声明和组装。

入口：`LLM_*`（[运行指南](../ray_agent/README.md)）；`ray_agent/api/app/domain/services/tools/base.py`、`tool.py`、`tool_call_compat.py`；内置 `file.py` / `shell.py` / `browser.py`。`config.yaml` 的 `llm_config` 只是未设环境变量时的回落，不要往里面写密钥。

不重讲 Chat Completions 或 Pydantic。不讲外层规划（[11](11-plan-and-react.md)）和协议工具（[14](14-mcp-and-a2a-in-the-product.md)）。
