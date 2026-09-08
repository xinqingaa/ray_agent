"""A2A 1.0 JSON-RPC 接入。SDK 处理协议，产品负责有界轮询与状态解释。"""
import asyncio
import logging
import uuid

import httpx
from a2a.client import ClientConfig, ClientFactory
from a2a.client.card_resolver import A2ACardResolver
from a2a.types import a2a_pb2 as types
from a2a.utils.errors import A2AError
from google.protobuf.json_format import MessageToDict, ParseError

from app.domain.models.app_config import A2AConfig, A2AServerConfig
from app.domain.models.tool_result import ToolResult
from .common import describe_content, discover_all, failure

logger = logging.getLogger(__name__)
ACTIVE = {types.TASK_STATE_SUBMITTED, types.TASK_STATE_WORKING}


def state_name(state: int) -> str:
    return types.TaskState.Name(state).removeprefix("TASK_STATE_").lower()


class A2AClientManager:
    def __init__(self, a2a_config: A2AConfig):
        self.config = a2a_config
        self.agent_cards: dict[str, types.AgentCard] = {}
        self.clients = {}
        self.http_clients: dict[str, httpx.AsyncClient] = {}
        self.errors: dict[str, str] = {}
        self.last_cancellations: dict[str, dict] = {}
        self.initialized = False

    @property
    def cards(self) -> list[dict]:
        return [{"id": id, "card": MessageToDict(card)} for id, card in self.agent_cards.items()]

    async def _connect(self, config: A2AServerConfig):
        http = httpx.AsyncClient(headers={**config.headers, "A2A-Version": "1.0"},
                                timeout=httpx.Timeout(config.call_timeout, connect=config.connect_timeout))
        self.http_clients[config.id] = http
        try:
            async with asyncio.timeout(config.discovery_timeout):
                card = await A2ACardResolver(http, str(config.base_url)).get_agent_card()
                if not card.name or not card.supported_interfaces:
                    raise ValueError("AgentCard 缺少名称或接口")
                if any(extension.required for extension in card.capabilities.extensions):
                    raise ValueError("AgentCard 要求未支持的扩展")
                if card.security_requirements and not config.headers:
                    raise ValueError("远程 Agent 要求认证，请配置请求头")
                factory = ClientFactory(ClientConfig(streaming=False, polling=False, httpx_client=http,
                    supported_protocol_bindings=["JSONRPC"], use_client_preference=True))
                self.clients[config.id] = factory.create(card)
                self.agent_cards[config.id] = card
        except BaseException as exc:
            self.errors.setdefault(config.id, "发现超时" if isinstance(exc, TimeoutError) else "连接或 A2A 卡片校验失败")
            await http.aclose()
            self.http_clients.pop(config.id, None)
            if isinstance(exc, asyncio.CancelledError):
                raise

    async def initialize(self):
        if self.initialized:
            return
        await discover_all({c.id: self._connect(c) for c in self.config.a2a_servers if c.enabled},
                           self.config.discovery_budget, self.errors)
        self.initialized = True

    async def _cancel_remote(self, agent_id: str, task_id: str | None, timeout: float):
        outcome = {"task_id": task_id, "remote_cancel": "unknown"}
        if task_id is None:
            outcome["remote_cancel"] = "no_task_id"
        else:
            try:
                async with asyncio.timeout(timeout):
                    task = await self.clients[agent_id].cancel_task(types.CancelTaskRequest(id=task_id))
                outcome["remote_cancel"] = "canceled" if task.status.state == types.TASK_STATE_CANCELED else "not_canceled"
                outcome["remote_state"] = state_name(task.status.state)
            except TimeoutError:
                outcome["remote_cancel"] = "timeout"
            except A2AError:
                outcome["remote_cancel"] = "rejected"
            except Exception:
                outcome["remote_cancel"] = "unknown"
        self.last_cancellations[agent_id] = outcome
        logger.info("A2A 取消结果 agent=%s %s", agent_id, outcome)

    async def invoke(self, agent_id: str, query: str) -> ToolResult:
        client = self.clients.get(agent_id)
        if client is None:
            return failure("unavailable", "远程 Agent 未连接或已禁用")
        config = next(c for c in self.config.a2a_servers if c.id == agent_id)
        task_id = None
        context_id = None
        remote_state = None
        try:
            async with asyncio.timeout(config.call_timeout):
                request = types.SendMessageRequest(message=types.Message(
                    message_id=str(uuid.uuid4()), role=types.ROLE_USER, parts=[types.Part(text=query)]))
                # 请求阻塞完成，但服务仍可能返回进行中的 Task。只发送一次 query。
                task = None
                async for response in client.send_message(request):
                    if response.HasField("message"):
                        message = response.message
                        if not message.message_id or message.role != types.ROLE_AGENT or not message.parts:
                            raise ValueError("非法 Message")
                        return ToolResult(message="远程 Agent 已回复", data={
                            "remote_state": "message", "message": describe_content(MessageToDict(message))})
                    if response.HasField("task"):
                        task = response.task
                    else:
                        raise ValueError("缺少 Message 或 Task")
                if task is None:
                    raise ValueError("远程返回空结果")
                interval = 1.0
                while True:
                    if not task.id or not task.context_id or not task.HasField("status"):
                        raise ValueError("非法 Task")
                    if task_id is not None and (task.id != task_id or task.context_id != context_id):
                        raise ValueError("轮询返回了不同 Task")
                    task_id, context_id = task.id, task.context_id
                    remote_state = state_name(task.status.state)
                    if task.status.state not in ACTIVE:
                        success = task.status.state == types.TASK_STATE_COMPLETED
                        reason = "\n".join(p.text for p in task.status.message.parts if p.HasField("text"))
                        data = {"task_id": task_id, "context_id": context_id, "remote_state": remote_state,
                                "task": describe_content(MessageToDict(task)),
                                "error_kind": None if success else "remote_state"}
                        if task.status.state == types.TASK_STATE_UNSPECIFIED:
                            raise ValueError("Task 状态未指定")
                        return ToolResult(success=success, message="远程任务已完成" if success else
                                          f"远程任务 {remote_state}: {reason or '未完成，需处理远程状态'}", data=data)
                    await asyncio.sleep(interval)
                    interval = min(5, interval * 1.5)
                    task = await client.get_task(types.GetTaskRequest(id=task_id))
        except asyncio.CancelledError:
            await self._cancel_remote(agent_id, task_id, config.cancel_timeout)
            raise
        except (TimeoutError, httpx.TimeoutException):
            return failure("timeout", "A2A 委派超时，远程结果未知；未重新提交", task_id=task_id,
                           context_id=context_id, remote_state=remote_state)
        except A2AError:
            return failure("protocol_error", "A2A 返回协议错误", task_id=task_id, remote_state=remote_state)
        except (ValueError, ParseError, TypeError):
            return failure("invalid_response", "A2A 返回非法响应", task_id=task_id, remote_state=remote_state)
        except Exception:
            return failure("transport_error", "A2A 连接中断，远程结果未知；未重新提交", task_id=task_id,
                           remote_state=remote_state)

    async def cleanup(self):
        try:
            async with asyncio.timeout(10):
                await asyncio.gather(*(c.aclose() for c in self.http_clients.values()))
        finally:
            self.clients.clear()
            self.http_clients.clear()
            self.agent_cards.clear()
            self.errors.clear()
            self.initialized = False
