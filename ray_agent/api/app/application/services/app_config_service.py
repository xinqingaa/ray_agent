#!/usr/bin/env python
# -*- coding: utf-8 -*-
import logging
import uuid
from typing import List, Dict

from app.application.errors.exceptions import NotFoundError, BadRequestError
from app.domain.services.context.budget import ContextBudget
from app.domain.models.app_config import AppConfig, LLMConfig, AgentConfig, MCPConfig, A2AConfig, A2AServerConfig, \
    ModelSampling, ToolPolicyConfig
from app.domain.repositories.app_config_repository import AppConfigRepository
from app.infrastructure.protocols.a2a import A2AClientManager
from app.infrastructure.protocols.mcp import MCPClientManager
from app.interfaces.schemas.app_config import ListMCPServerItem, ListA2AServerItem

logger = logging.getLogger(__name__)


class AppConfigService:
    """应用配置服务"""

    def __init__(self, app_config_repository: AppConfigRepository) -> None:
        """构造函数，完成应用配置服务的初始化"""
        self.app_config_repository = app_config_repository

    async def _load_app_config(self) -> AppConfig:
        """加载获取所有的应用配置"""
        return self.app_config_repository.load()

    async def get_context_config(
            self, model_id: str | None = None, reasoning: str | None = None, sampling: ModelSampling | None = None,
    ) -> Dict[str, int]:
        """返回这条对话实际使用的容量。已记下数值时用记下的，否则用该模型当前配置。"""
        from app.domain.models.model_catalog import configured_sampling, provider_for, resolve_selection, tuned_limits
        config = await self._load_app_config()
        llm, agent = config.llm_config, config.agent_config
        base = sampling or configured_sampling(llm, model_id)
        window, tokens = base.context_window, base.max_tokens
        provider = provider_for(str(llm.base_url))
        if provider:
            try:
                spec, choice = resolve_selection(provider, model_id, reasoning)
                window, tokens = tuned_limits(base.max_tokens, base.context_window, spec, choice)
            except ValueError:
                pass
        budget = ContextBudget(window, tokens, agent.context_safety_ratio, agent.compact_watermark)
        return {"context_window": budget.context_window, "max_tokens": budget.max_tokens,
                "limit": budget.limit, "watermark": budget.watermark}

    async def get_llm_config(self) -> LLMConfig:
        """获取LLM提供商配置"""
        app_config = await self._load_app_config()
        return app_config.llm_config

    async def update_llm_config(self, fields: Dict) -> LLMConfig:
        """更新调用方提交的字段。未提交的保持原值；密钥、流式和超时不从页面写入。"""
        from app.domain.models.model_catalog import model_list, provider_for
        app_config = await self._load_app_config()
        current = app_config.llm_config
        data = dict(fields)
        data.pop("api_key", None)
        if "model_profiles" in data:
            if data["model_profiles"] is None:
                data.pop("model_profiles")
            else:
                data["model_profiles"] = self._cap_profiles(
                    str(data.get("base_url", current.base_url)), data["model_profiles"], provider_for, model_list,
                )
        if "model_profiles" in data:
            data["model_profiles"] = {**current.model_profiles, **data["model_profiles"]}
        app_config.llm_config = LLMConfig.model_validate({
            **current.model_dump(),
            **data,
            "api_key": current.api_key,
            "streaming": current.streaming,
            "request_timeout": current.request_timeout,
        })
        self._validate_sampling(app_config.llm_config, app_config.agent_config)
        self.app_config_repository.save(app_config)
        return app_config.llm_config

    @staticmethod
    def _cap_profiles(base_url: str, profiles: dict, provider_for, model_list) -> dict:
        """已知模型的窗口和输出不超过目录上限。目录里没有的 id 不保留。"""
        provider = provider_for(base_url)
        if provider is None:
            return {key: ModelSampling.model_validate(value) for key, value in profiles.items()}
        specs = {item.id: item for item in model_list(provider)}
        capped = {}
        for model_id, raw in profiles.items():
            spec = specs.get(model_id)
            if spec is None:
                raise BadRequestError(f"未知模型 {model_id}")
            profile = ModelSampling.model_validate(raw)
            if profile.context_window > spec.context_window or profile.max_tokens > spec.max_output:
                raise BadRequestError(f"{model_id} 超过模型能力上限：窗口 {spec.context_window}，生成 {spec.max_output}")
            capped[model_id] = profile
        return capped

    @staticmethod
    def _validate_sampling(llm: LLMConfig, agent: AgentConfig) -> None:
        from app.domain.models.model_catalog import model_list, provider_for, configured_sampling, tuned_limits
        models = model_list(provider_for(str(llm.base_url)) or "")
        for spec in models:
            base = configured_sampling(llm, spec.id)
            if spec.temperature_max is not None and base.temperature > spec.temperature_max:
                raise BadRequestError(f"{spec.id} 温度范围为 0 到 {spec.temperature_max:g}")
            for choice in spec.choices:
                window, tokens = tuned_limits(base.max_tokens, base.context_window, spec, choice)
                if ContextBudget(window, tokens, agent.context_safety_ratio, agent.compact_watermark).limit <= 0:
                    raise BadRequestError(f"{spec.id} 在 {choice.id} 下没有可用输入空间，请增大窗口或减少生成预算")
        if not models and ContextBudget(llm.context_window, llm.max_tokens,
                agent.context_safety_ratio, agent.compact_watermark).limit <= 0:
            raise BadRequestError("没有可用输入空间，请增大窗口或减少生成预算")

    async def preview_sampling(self, model: str, sampling: ModelSampling) -> dict:
        from app.domain.models.model_catalog import provider_for, resolve_selection
        config = await self._load_app_config()
        provider = provider_for(str(config.llm_config.base_url))
        if provider is None:
            raise BadRequestError("当前接口没有模型能力目录")
        try:
            spec, _ = resolve_selection(provider, model, None)
        except ValueError as exc:
            raise BadRequestError(str(exc)) from exc
        return {choice.id: await self.get_context_config(model, choice.id, sampling) for choice in spec.choices}

    async def get_agent_config(self) -> AgentConfig:
        """获取Agent通用配置"""
        app_config = await self._load_app_config()
        return app_config.agent_config

    async def update_agent_config(self, agent_config: AgentConfig) -> AgentConfig:
        """根据传递的agent_config更新Agent通用配置"""
        # 1.获取应用配置
        app_config = await self._load_app_config()

        # 2.调用函数更新app_config
        app_config.agent_config = agent_config
        self.app_config_repository.save(app_config)

        return app_config.agent_config

    async def get_tool_policy(self) -> ToolPolicyConfig:
        """获取工具策略表"""
        app_config = await self._load_app_config()
        return app_config.tool_policy

    async def update_tool_policy(self, tool_policy: ToolPolicyConfig) -> ToolPolicyConfig:
        """整体替换工具策略表；从下一次创建的执行任务起生效（新运行或审批、提问续接），进行中的运行不受影响。"""
        app_config = await self._load_app_config()
        app_config.tool_policy = tool_policy
        self.app_config_repository.save(app_config)
        return app_config.tool_policy

    async def get_mcp_servers(self) -> List[ListMCPServerItem]:
        """获取MCP服务器列表"""
        # 1.获取当前应用配置
        app_config = await self._load_app_config()

        # 2.创建mcp客户端管理器，对配置信息不进行过滤
        mcp_servers = []
        mcp_client_manager = MCPClientManager(mcp_config=app_config.mcp_config)

        try:
            # 3.初始化mcp客户端管理器
            await mcp_client_manager.initialize()

            # 4.获取mcp客户端管理器的工具列表
            tools = mcp_client_manager.tools

            # 5.循环组装响应的工具格式
            for server_name, server_config in app_config.mcp_config.mcpServers.items():
                mcp_servers.append(ListMCPServerItem(
                    server_name=server_name,
                    enabled=server_config.enabled,
                    transport=server_config.transport,
                    tools=[tool.name for tool in tools.get(server_name, [])],
                    connection_status="disabled" if not server_config.enabled else
                        "connected" if server_name in tools else "unavailable",
                    error=mcp_client_manager.errors.get(server_name),
                ))
        finally:
            # 6.清除MCP客户端管理器的相关资源
            await mcp_client_manager.cleanup()

        return mcp_servers

    async def update_and_create_mcp_servers(self, mcp_config: MCPConfig) -> MCPConfig:
        """根据传递的数据新增或更新MCP配置"""
        # 1.获取应用配置
        app_config = await self._load_app_config()

        # 2.使用新的mcp_config更新原始的配置
        app_config.mcp_config.mcpServers.update(mcp_config.mcpServers)
        if "discovery_budget" in mcp_config.model_fields_set:
            app_config.mcp_config.discovery_budget = mcp_config.discovery_budget

        # 3.调用数据仓库完成存储or更新
        self.app_config_repository.save(app_config)
        return app_config.mcp_config

    async def delete_mcp_server(self, server_name: str) -> MCPConfig:
        """根据名字删除MCP服务"""
        # 1.获取应用配置
        app_config = await self._load_app_config()

        # 2.查询对应服务的名字是否存在
        if server_name not in app_config.mcp_config.mcpServers:
            raise NotFoundError(f"该MCP服务[{server_name}]不存在，请核实后重试")

        # 3.如果存在则删除字典中对应的服务
        del app_config.mcp_config.mcpServers[server_name]
        self.app_config_repository.save(app_config)
        return app_config.mcp_config

    async def set_mcp_server_enabled(self, server_name: str, enabled: bool) -> MCPConfig:
        """更新MCP服务的启用状态"""
        # 1.获取应用配置
        app_config = await self._load_app_config()

        # 2.查询对应服务的名字是否存在
        if server_name not in app_config.mcp_config.mcpServers:
            raise NotFoundError(f"该MCP服务[{server_name}]不存在，请核实后重试")

        # 3.如果存在则更新该MCP服务的启用状态
        app_config.mcp_config.mcpServers[server_name].enabled = enabled
        self.app_config_repository.save(app_config)
        return app_config.mcp_config

    async def create_a2a_server(self, base_url: str) -> A2AConfig:
        """根据传递的配置新增a2a服务器"""
        # 1.获取当前的应用配置
        app_config = await self._load_app_config()

        # 2.往数据中新增a2a服务(在新增之前其实可以检测下当前Agent是否存在)
        a2a_server_config = A2AServerConfig(
            id=str(uuid.uuid4()),
            base_url=base_url,
            enabled=True,
        )
        app_config.a2a_config.a2a_servers.append(a2a_server_config)

        # 3.调用数据仓库更新
        self.app_config_repository.save(app_config)
        return app_config.a2a_config

    async def get_a2a_servers(self) -> List[ListA2AServerItem]:
        """获取A2A服务列表"""
        # 1.获取当前的应用配置
        app_config = await self._load_app_config()

        # 2.构建a2a客户端管理器，对配置信息不过滤
        a2a_servers = []
        a2a_client_manager = A2AClientManager(app_config.a2a_config)

        try:
            # 3.初始化a2a客户端管理器
            await a2a_client_manager.initialize()

            # 4.获取Agent卡片列表
            agent_cards = a2a_client_manager.agent_cards

            # 5.组装响应结构
            for config in app_config.a2a_config.a2a_servers:
                card = agent_cards.get(config.id)
                a2a_servers.append(ListA2AServerItem(
                    id=config.id, base_url=str(config.base_url),
                    name=card.name if card else str(config.base_url),
                    description=card.description if card else "",
                    input_modes=list(card.default_input_modes) if card else [],
                    output_modes=list(card.default_output_modes) if card else [],
                    streaming=card.capabilities.streaming if card else False,
                    push_notifications=card.capabilities.push_notifications if card else False,
                    enabled=config.enabled,
                    connection_status="disabled" if not config.enabled else "connected" if card else "unavailable",
                    error=a2a_client_manager.errors.get(config.id),
                ))
        finally:
            # 6.清除客户端管理器资源
            await a2a_client_manager.cleanup()

        return a2a_servers

    async def set_a2a_server_enabled(self, a2a_id: str, enabled: bool) -> A2AConfig:
        """根据传递的id+enabled更新服务启用状态"""
        # 1.获取当前的应用配置
        app_config = await self._load_app_config()

        # 2.计算需要更新位置的索引并判断是否存在
        idx = None
        for item_idx, item in enumerate(app_config.a2a_config.a2a_servers):
            if item.id == a2a_id:
                idx = item_idx
                break
        if idx is None:
            raise NotFoundError(f"该A2A服务[{a2a_id}]不存在，请核实后重试")

        # 3.如果存在则更新数据
        app_config.a2a_config.a2a_servers[idx].enabled = enabled
        self.app_config_repository.save(app_config)
        return app_config.a2a_config

    async def delete_a2a_server(self, a2a_id: str) -> A2AConfig:
        """根据传递的id删除指定的a2a服务"""
        # 1.获取当前的应用配置
        app_config = await self._load_app_config()

        # 2.计算需要操作位置的索引并判断是否存在
        idx = None
        for item_idx, item in enumerate(app_config.a2a_config.a2a_servers):
            if item.id == a2a_id:
                idx = item_idx
                break
        if idx is None:
            raise NotFoundError(f"该A2A服务[{a2a_id}]不存在，请核实后重试")

        # 3.删除a2a服务器
        del app_config.a2a_config.a2a_servers[idx]
        self.app_config_repository.save(app_config)
        return app_config.a2a_config
