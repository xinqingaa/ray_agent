#!/usr/bin/env python
# -*- coding: utf-8 -*-
import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Optional, Dict, Any, AsyncGenerator, Union

from app.application.services.context_operations import context_operation

from fastapi import APIRouter, Depends, Header, Query, Body
from sse_starlette import EventSourceResponse, ServerSentEvent

from app.application.errors.exceptions import BadRequestError, NotFoundError
from app.application.services.app_config_service import AppConfigService
from app.application.services.agent_service import AgentService, ChatAccepted
from app.application.services.session_service import SessionService
from app.application.services.title_service import TitleService
from app.domain.external.event_notifier import OutputDelta
from app.domain.models.event import Event
from app.domain.models.identity import RequestId
from app.domain.models.run import RunMode
from app.domain.models.app_config import ModelSampling
from app.domain.models.session import Session
from app.interfaces.schemas import Response
from app.interfaces.schemas.event import DeltaSSEEvent, EventMapper
from app.interfaces.schemas.session import (
    CreateSessionRequest, CreateSessionResponse,
    ListSessionResponse,
    ListSessionItem,
    ChatRequest,
    ChatResponse,
    ModelSelectionRequest,
    ModelSelectionResponse,
    GetSessionResponse, GetSessionFilesResponse,
    RunItem,
    UnconsumedInputItem,
    TurnRequestResponse,
    ApprovalRequest,
    ApprovalResponse,
    CompactResponse,
    RenameTitleRequest, TitleResponse,
)
from app.infrastructure.external.notification.local_notifier import catalog_notifier
from app.interfaces.service_dependencies import (
    get_app_config_service,
    get_session_service, get_agent_service, get_title_service,
)

logger = logging.getLogger(__name__)

CATALOG_FALLBACK_SECONDS = 30.0  # 列表流没有目录通知时的兜底查询间隔


def _saved_sampling(session: Session) -> Optional[ModelSampling]:
    """这条对话已经记下的窗口、输出上限和温度。还没运行过则为空，界面改用当前模型配置。"""
    if session.context_window is None or session.max_tokens is None or session.temperature is None:
        return None
    return ModelSampling(
        temperature=session.temperature, max_tokens=session.max_tokens, context_window=session.context_window,
    )
router = APIRouter(prefix="/sessions", tags=["会话模块"])


def session_list_item(session: Session) -> ListSessionItem:
    """列表与列表流共用。"""
    return ListSessionItem(
        session_id=session.id,
        workspace_id=session.workspace_id,
        title=session.title,
        latest_message=session.latest_message,
        latest_message_at=session.latest_message_at,
        status=session.status,
        unread_message_count=session.unread_message_count,
    )


@router.post(
    path="",
    response_model=Response[CreateSessionResponse],
    summary="创建新任务会话",
    description="创建一个空白的新任务会话",
)
async def create_session(
        request: Optional[CreateSessionRequest] = Body(default=None),
        session_service: SessionService = Depends(get_session_service),
) -> Response[CreateSessionResponse]:
    """创建一个空白的新任务会话；同一创建标识重复提交返回同一会话"""
    creation_id = str(request.creation_id) if request and request.creation_id else None
    session = await session_service.create_session(creation_id, request.workspace_id if request else None)
    return Response.success(
        data=CreateSessionResponse(session_id=session.id)
    )


@router.post(
    path="/stream",
    summary="流式获取所有会话基础信息列表",
    description="连接后先推送一页列表。目录有写入时再查；没有通知时最多每 30 秒兜底一次。内容没变不重复推送。",
)
async def stream_sessions(
        offset: int = Query(default=0, ge=0),
        limit: int = Query(default=50, ge=1, le=100),
        workspace_id: Optional[str] = Query(default=None, description="只列出该工作区的会话"),
        independent: bool = Query(default=False, description="只列出没有工作区的独立对话；不能与 workspace_id 同时使用"),
        session_service: SessionService = Depends(get_session_service),
) -> EventSourceResponse:
    """列表流：通知驱动，附带慢速兜底。每次查询用一个短的只读工作单元，等待通知与推送时不持有连接。"""
    if workspace_id and independent:
        raise BadRequestError("workspace_id 与 independent 不能同时指定")

    async def event_generator() -> AsyncGenerator[ServerSentEvent, None]:
        subscription = catalog_notifier().subscribe()
        last_payload = None
        try:
            while True:
                sessions, total = await session_service.page(offset=offset, limit=limit,
                                                            workspace_id=workspace_id, independent=independent)
                session_items = [session_list_item(session) for session in sessions]
                payload = ListSessionResponse(
                    sessions=session_items, total=total, offset=offset, limit=limit).model_dump_json()
                if payload != last_payload:
                    last_payload = payload
                    yield ServerSentEvent(event="sessions", data=payload)
                hint = None
                if subscription is not None:
                    try:
                        hint = await subscription.get(timeout=CATALOG_FALLBACK_SECONDS)
                    except Exception as exc:
                        logger.warning(f"读取目录通知失败，改为定时兜底: {exc}")
                        await subscription.close()
                        subscription = None
                else:
                    await asyncio.sleep(CATALOG_FALLBACK_SECONDS)
                if hint:
                    yield ServerSentEvent(event="catalog", data=json.dumps(hint))
        finally:
            if subscription is not None:
                await subscription.close()

    return EventSourceResponse(event_generator())


@router.get(
    path="",
    response_model=Response[ListSessionResponse],
    summary="获取会话列表基础信息",
    description="获取MoocManus项目中所有任务会话基础信息列表",
)
async def get_all_sessions(
        offset: int = Query(default=0, ge=0),
        limit: int = Query(default=50, ge=1, le=100),
        workspace_id: Optional[str] = Query(default=None, description="只列出该工作区的会话"),
        independent: bool = Query(default=False, description="只列出没有工作区的独立对话；不能与 workspace_id 同时使用"),
        session_service: SessionService = Depends(get_session_service),
) -> Response[ListSessionResponse]:
    """会话列表基础信息，按最新消息时间倒序"""
    sessions, total = await session_service.page(offset=offset, limit=limit, workspace_id=workspace_id,
                                                    independent=independent)
    session_items = [session_list_item(session) for session in sessions]
    return Response.success(
        data=ListSessionResponse(sessions=session_items, total=total, offset=offset, limit=limit)
    )


@router.post(
    path="/{session_id}/clear-unread-message-count",
    response_model=Response[Optional[Dict]],
    summary="清除指定任务会话未读消息数",
    description="清除指定任务会话未读消息数",
)
async def clear_unread_message_count(
        session_id: str,
        session_service: SessionService = Depends(get_session_service),
) -> Response[Optional[Dict]]:
    """根据传递的会话id清空未读消息数"""
    await session_service.clear_unread_message_count(session_id)
    return Response.success()


@router.post(
    path="/{session_id}/delete",
    response_model=Response[Optional[Dict]],
    summary="删除指定任务会话",
    description="根据传递的会话id删除指定任务会话",
)
async def delete_session(
        session_id: str,
        session_service: SessionService = Depends(get_session_service),
) -> Response[Optional[Dict]]:
    """根据传递的会话id删除指定任务会话"""
    await session_service.delete_session(session_id)
    return Response.success()


@router.post(
    path="/{session_id}/chat",
    response_model=Response[ChatResponse],
    summary="向指定任务会话发送消息",
    description="受理一条用户消息并立即返回 run_id 与消息事件的 seq；执行过程通过事件流接口观察。"
                "mode 为 plan 时新运行以计划模式执行；会话有活动运行（会注入或续接）时带 plan 返回 409。"
                "带 request_id 时同身份同内容返回原受理结果，内容不同返回 409；结果未知时按身份读回",
)
async def chat(
        session_id: str,
        request: ChatRequest,
        agent_service: AgentService = Depends(get_agent_service),
) -> Response[ChatResponse]:
    """根据传递的会话id+chat请求数据向指定会话发送消息"""
    accepted = await agent_service.chat(
        session_id=session_id,
        message=request.message,
        attachments=request.attachments,
        timestamp=datetime.fromtimestamp(request.timestamp, timezone.utc) if request.timestamp else None,
        mode=RunMode(request.mode),
        model=request.model,
        reasoning=request.reasoning,
        image_mode=request.image_mode,
        skill=request.skill,
        execute_plan=request.execute_plan,
        request_id=request.request_id,
    )
    return Response.success(data=chat_response(accepted))


def chat_response(accepted: ChatAccepted) -> ChatResponse:
    return ChatResponse(run_id=accepted.run_id, seq=accepted.seq, route=accepted.route)


@router.get(
    path="/{session_id}/requests/{request_id}",
    response_model=Response[ChatResponse],
    summary="按请求身份读回受理结果",
    description="发送结果未知时先读回；没有受理记录返回 404，此时原请求尚未被核心受理，可以按同一身份重新发送",
)
async def get_accepted_request(
        session_id: str,
        request_id: RequestId,
        agent_service: AgentService = Depends(get_agent_service),
) -> Response[ChatResponse]:
    return Response.success(data=chat_response(await agent_service.accepted_request(session_id, request_id)))


@router.post(
    path="/{session_id}/inputs/{input_id}/resume",
    response_model=Response[ChatResponse],
    summary="重新发起未处理的消息",
    description="所属运行已结束（如核心重启中断或被停止）而尚未进入模型历史的消息，明确交给一个新运行处理；"
                "消息不重复写入。已处理、正在处理或会话已有活动运行时返回 409",
)
async def resume_input(
        session_id: str,
        input_id: int,
        agent_service: AgentService = Depends(get_agent_service),
) -> Response[ChatResponse]:
    return Response.success(data=chat_response(await agent_service.resume_input(session_id, input_id)))


@router.put(
    path="/{session_id}/model",
    response_model=Response[ModelSelectionResponse],
    summary="保存会话的模型与思考强度",
    description="写入下一次新运行使用的模型 id 与思考参数。进行中的运行仍用自己的快照。",
)
async def set_session_model(
        session_id: str,
        request: ModelSelectionRequest,
        agent_service: AgentService = Depends(get_agent_service),
) -> Response[ModelSelectionResponse]:
    model, reasoning = await agent_service.set_model(session_id, request.model, request.reasoning)
    return Response.success(data=ModelSelectionResponse(model=model, reasoning=reasoning))


@router.post(
    path="/{session_id}/compact",
    response_model=Response[CompactResponse],
    summary="手动压缩会话上下文",
    description="没有活动运行时把较早的轮次替换为摘要，写入不属于任何运行的 compact(trigger=manual) 与 context(replace)。"
                "会话不存在 404；有运行中或等待中（提问或审批）的运行 409；少于 2 轮返回 status=skipped；"
                "摘要请求失败 502，上下文不变。压缩期间 chat/compact 及时返回 409；摘要总期限 60 秒，超时结果需读回核对",
)
async def compact_session(
        session_id: str,
        agent_service: AgentService = Depends(get_agent_service),
) -> Response[CompactResponse]:
    result = await agent_service.compact_session(session_id)
    if result.status == "skipped":
        return Response.success(data=CompactResponse(
            status="skipped", reason=result.reason, message="没有可压缩的较早轮次"))
    message = f"已把较早的 {result.summarized_turns} 轮对话压缩为摘要"
    if result.after_total is not None and result.before_total is not None and result.after_total >= result.before_total:
        message = "已摘要，估算空间未减少"
    return Response.success(data=CompactResponse(
        status="compacted",
        message=message,
        compact_seq=result.compact_seq,
        context_seq=result.context_seq,
        before_total=result.before_total,
        after_total=result.after_total,
        summarized_turns=result.summarized_turns,
        kept_turns=result.kept_turns,
    ))


@router.put(path="/{session_id}/title", response_model=Response[TitleResponse], summary="重命名会话")
async def rename_title(
        session_id: str,
        request: RenameTitleRequest,
        title_service: TitleService = Depends(get_title_service),
) -> Response[TitleResponse]:
    title = await title_service.set_title(session_id, request.title)
    return Response.success(data=TitleResponse(title=title))


@router.post(path="/{session_id}/title/suggestion", response_model=Response[TitleResponse], summary="生成标题建议")
async def suggest_title(
        session_id: str,
        title_service: TitleService = Depends(get_title_service),
) -> Response[TitleResponse]:
    title = await title_service.suggest(session_id)
    return Response.success(data=TitleResponse(title=title))


@router.post(
    path="/{session_id}/approvals/{tool_call_id}",
    response_model=Response[ApprovalResponse],
    summary="回复工具调用的审批",
    description="decision 为 approve（执行该调用一次）或 deny（回填“用户拒绝执行”）；运行随后续接，过程通过事件流观察。"
                "审批请求不存在返回 404；已回复、已失效或运行已结束返回 409，不重复执行",
)
async def reply_approval(
        session_id: str,
        tool_call_id: str,
        request: ApprovalRequest,
        agent_service: AgentService = Depends(get_agent_service),
) -> Response[ApprovalResponse]:
    accepted = await agent_service.reply_approval(session_id, tool_call_id, approve=request.decision == "approve")
    return Response.success(
        data=ApprovalResponse(run_id=accepted.run_id, seq=accepted.seq, status=accepted.status),
    )


@router.get(
    path="/{session_id}/events",
    summary="按序号订阅会话事件",
    description="SSE：推送 after_seq（或 Last-Event-ID）之后的全部事件，每条的 id 是会话内 seq；连接不主动结束",
)
async def stream_events(
        session_id: str,
        after_seq: Optional[int] = Query(default=None, ge=0),
        last_event_id: Optional[str] = Header(default=None),
        agent_service: AgentService = Depends(get_agent_service),
        session_service: SessionService = Depends(get_session_service),
) -> EventSourceResponse:
    """断线重连时浏览器 EventSource 会带 Last-Event-ID；显式的 after_seq 优先"""
    if not await session_service.get_session(session_id):
        raise NotFoundError("该会话不存在，请核实后重试")
    start = after_seq
    if start is None:
        start = int(last_event_id) if last_event_id and last_event_id.isdigit() else 0

    async def event_generator() -> AsyncGenerator[ServerSentEvent, None]:
        async for item in agent_service.stream_events(session_id, after_seq=start):
            yield to_session_sse(item)

    return EventSourceResponse(event_generator(), ping=15)


def to_session_sse(item: Union[Event, OutputDelta]) -> ServerSentEvent:
    """信封的 event 写入 SSE event 行、data 写入 data 行；落库事件带 seq 作为 SSE id，文本增量没有 id，重连不会补发。"""
    if isinstance(item, OutputDelta):
        delta = DeltaSSEEvent.from_delta(item)
        return ServerSentEvent(event=delta.event, data=delta.data.model_dump_json())
    sse_event = EventMapper.event_to_sse_event(item)
    return ServerSentEvent(
        id=str(item.seq) if item.seq is not None else None,
        event=sse_event.event,
        data=sse_event.data.model_dump_json(),
    )


@router.get(
    path="/{session_id}",
    response_model=Response[GetSessionResponse],
    summary="获取指定会话详情信息",
    description="返回会话、全部运行，以及 after_seq 之后按 seq 升序的事件（limit 为空时读到最新）",
)
async def get_session(
        session_id: str,
        after_seq: int = Query(default=0, ge=0),
        limit: Optional[int] = Query(default=None, ge=1, le=5000),
        session_service: SessionService = Depends(get_session_service),
        config_service: AppConfigService = Depends(get_app_config_service),
) -> Response[GetSessionResponse]:
    """传递指定会话id获取该会话的对话详情"""
    detail = await session_service.get_session_detail(session_id, after_seq=after_seq, limit=limit)
    if not detail:
        raise NotFoundError("该会话不存在，请核实后重试")
    active = next((run for run in detail.runs if run.status.active), None)
    snapshot = (active.config_snapshot or {}) if active is not None else {}
    return Response.success(
        data=GetSessionResponse(
            session_id=detail.session.id,
            title=detail.session.title,
            status=detail.session.status,
            runs=[RunItem.from_run(run) for run in detail.runs],
            events=EventMapper.events_to_sse_events(detail.events),
            last_seq=detail.last_seq,
            context_operation=context_operation(session_id),
            context_config=await config_service.get_context_config(
                detail.session.model_id, detail.session.reasoning, _saved_sampling(detail.session)),
            unconsumed_inputs=[UnconsumedInputItem(input_id=item.id, run_id=item.run_id, message_seq=item.message_seq,
                                                   request_id=item.request_id) for item in detail.unconsumed_inputs],
            model_id=detail.session.model_id,
            reasoning=detail.session.reasoning,
            run_model=snapshot.get("model_name"),
            run_reasoning=snapshot.get("reasoning"),
        )
    )


@router.get("/{session_id}/context-preview", response_model=Response[Dict[str, Any]])
async def preview_context(session_id: str, mode: RunMode = Query(default=RunMode.NORMAL),
        service: AgentService = Depends(get_agent_service)):
    return Response.success(data=await service.preview_context(session_id, mode))


@router.get(
    path="/{session_id}/runs/{run_id}/turns/{index}/request",
    response_model=Response[TurnRequestResponse],
    summary="重建某一轮的模型请求",
    description="只读调试：由运行的配置快照与事件重建该轮发给模型的消息与工具，不重放任何动作",
)
async def get_turn_request(
        session_id: str,
        run_id: str,
        index: int,
        agent_service: AgentService = Depends(get_agent_service),
) -> Response[TurnRequestResponse]:
    rebuilt = await agent_service.get_turn_request(session_id, run_id, index)
    return Response.success(
        data=TurnRequestResponse(
            run_id=rebuilt.run_id,
            index=rebuilt.index,
            turn_seq=rebuilt.turn_seq,
            api_protocol=rebuilt.api_protocol,
            messages=rebuilt.messages,
            tools=rebuilt.tools,
            images=rebuilt.images,
        ),
    )


@router.post(
    path="/{session_id}/stop",
    response_model=Response[Optional[Dict]],
    summary="停止指定任务会话",
    description="根据传递的指定会话id停止对应任务会话",
)
async def stop_session(
        session_id: str,
        agent_service: AgentService = Depends(get_agent_service),
) -> Response[Optional[Dict]]:
    """根据传递的指定会话id停止对应任务会话；返回被停止的运行 id，没有进行中的运行时为空"""
    run = await agent_service.stop_session(session_id)
    return Response.success(data={"run_id": run.id} if run else None)


@router.get(
    path="/{session_id}/files",
    response_model=Response[GetSessionFilesResponse],
    summary="获取指定任务会话文件列表信息",
    description="获取指定任务会话文件列表信息",
)
async def get_session_files(
        session_id: str,
        session_service: SessionService = Depends(get_session_service),
) -> Response[GetSessionFilesResponse]:
    """获取指定任务会话文件列表信息"""
    files = await session_service.get_session_files(session_id)
    return Response.success(
        data=GetSessionFilesResponse(files=files)
    )
