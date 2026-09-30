#!/usr/bin/env python
# -*- coding: utf-8 -*-
import asyncio
import json
import logging
from datetime import datetime
from typing import Optional, Dict, AsyncGenerator, Union

import websockets
from app.application.services.context_operations import context_operation

from fastapi import APIRouter, Depends, Header, Query, Body
from sse_starlette import EventSourceResponse, ServerSentEvent
from starlette.websockets import WebSocket, WebSocketDisconnect
from websockets import ConnectionClosed

from app.application.errors.exceptions import NotFoundError
from app.application.services.app_config_service import AppConfigService
from app.application.services.agent_service import AgentService
from app.application.services.project_service import ProjectService
from app.application.services.session_service import SessionService
from app.application.services.title_service import TitleService
from app.domain.external.event_notifier import OutputDelta
from app.domain.models.event import Event
from app.domain.models.project import GitDiff, GitStatus, ProjectFile, ProjectListing, ProjectView
from app.domain.models.run import RunMode
from app.domain.models.session import Session
from app.interfaces.schemas import Response
from app.interfaces.schemas.event import EventMapper
from app.interfaces.schemas.session import (
    CreateSessionRequest, CreateSessionResponse, ProjectStartObservation,
    ListSessionResponse,
    ListSessionItem,
    ChatRequest,
    ChatResponse,
    GetSessionResponse, GetSessionFilesResponse, FileReadResponse, FileReadRequest, ShellReadResponse, ShellReadRequest,
    RunItem,
    TurnRequestResponse,
    ApprovalRequest,
    ApprovalResponse,
    CompactResponse,
    RenameTitleRequest, TitleResponse,
)
from app.interfaces.schemas.project import BindProjectRequest
from app.interfaces.service_dependencies import (
    get_app_config_service,
    get_session_service, get_agent_service, get_title_service, get_project_service,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/sessions", tags=["会话模块"])

# 流式获取会话详情睡眠间隔
SESSION_SLEEP_INTERVAL = 5


def session_list_item(session: Session, project_service: ProjectService, project_views=None) -> ListSessionItem:
    """列表与列表流共用。project 每次用路径校验实时计算，不缓存。"""
    return ListSessionItem(
        session_id=session.id,
        title=session.title,
        latest_message=session.latest_message,
        latest_message_at=session.latest_message_at,
        status=session.status,
        unread_message_count=session.unread_message_count,
        project=project_views.get(session.id) if project_views is not None else project_service.describe(session.project),
    )


@router.post(
    path="",
    response_model=Response[CreateSessionResponse],
    summary="创建新任务会话",
    description="创建一个空白的新任务会话",
)
async def create_session(
        request: Optional[CreateSessionRequest] = Body(default=None),
        project_service: ProjectService = Depends(get_project_service),
        session_service: SessionService = Depends(get_session_service),
) -> Response[CreateSessionResponse]:
    """创建一个空白的新任务会话"""
    session = await project_service.create_session(request.project_id) if request and request.project_id else await session_service.create_session()
    return Response.success(
        msg="创建任务会话成功",
        data=CreateSessionResponse(session_id=session.id)
    )


@router.post(
    path="/stream",
    summary="流式获取所有会话基础信息列表",
    description="间隔指定时间流式获取所有会话基础信息列表",
)
async def stream_sessions(
        project_id: Optional[str] = Query(default=None),
        independent: bool = Query(default=False),
        offset: int = Query(default=0, ge=0),
        limit: int = Query(default=50, ge=1, le=100),
        session_service: SessionService = Depends(get_session_service),
        project_service: ProjectService = Depends(get_project_service),
) -> EventSourceResponse:
    """间隔指定时间流式获取所有会话基础信息列表"""

    async def event_generator() -> AsyncGenerator[ServerSentEvent, None]:
        """定义一个异步迭代器，用于获取所有会话列表"""
        while True:
            # 1.获取所有会话列表
            sessions, total = await session_service.page(project_id=project_id, independent=independent, offset=offset, limit=limit)

            # 2.循环遍历并组装数据
            project_views = project_service.describe_sessions(sessions)
            session_items = [session_list_item(session, project_service, project_views) for session in sessions]

            # 3.将会话列表转换为流式事件数据并返回
            yield ServerSentEvent(
                event="sessions",
                data=ListSessionResponse(sessions=session_items, total=total, offset=offset, limit=limit).model_dump_json(),
            )

            # 4.睡眠指定时间避免高频响应
            await asyncio.sleep(SESSION_SLEEP_INTERVAL)

    return EventSourceResponse(event_generator())


@router.get(
    path="",
    response_model=Response[ListSessionResponse],
    summary="获取会话列表基础信息",
    description="获取MoocManus项目中所有任务会话基础信息列表",
)
async def get_all_sessions(
        project_id: Optional[str] = Query(default=None),
        independent: bool = Query(default=False),
        offset: int = Query(default=0, ge=0),
        limit: int = Query(default=50, ge=1, le=100),
        session_service: SessionService = Depends(get_session_service),
        project_service: ProjectService = Depends(get_project_service),
) -> Response[ListSessionResponse]:
    """获取MoocManus项目中所有任务会话基础信息列表"""
    sessions, total = await session_service.page(project_id=project_id, independent=independent, offset=offset, limit=limit)
    project_views = project_service.describe_sessions(sessions)
    session_items = [session_list_item(session, project_service, project_views) for session in sessions]
    return Response.success(
        msg="获取任务会话列表成功",
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
    return Response.success(msg="清除未读消息数成功")


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
    return Response.success(msg="删除任务会话成功")


@router.post(
    path="/{session_id}/chat",
    response_model=Response[ChatResponse],
    summary="向指定任务会话发送消息",
    description="受理一条用户消息并立即返回 run_id 与消息事件的 seq；执行过程通过事件流接口观察。"
                "mode 为 plan 时新运行以计划模式执行；会话有活动运行（会注入或续接）时带 plan 返回 409",
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
        timestamp=datetime.fromtimestamp(request.timestamp) if request.timestamp else None,
        mode=RunMode(request.mode),
    )
    return Response.success(
        msg="消息已受理",
        data=ChatResponse(run_id=accepted.run_id, seq=accepted.seq, route=accepted.route),
    )


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
        return Response.success(msg="没有可压缩的较早轮次", data=CompactResponse(
            status="skipped", reason=result.reason, message="没有可压缩的较早轮次"))
    message = f"已把较早的 {result.summarized_turns} 轮对话压缩为摘要"
    if result.after_total is not None and result.before_total is not None and result.after_total >= result.before_total:
        message = "已摘要，估算空间未减少"
    return Response.success(msg=message, data=CompactResponse(
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
        msg="审批已受理",
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
            sse_event = to_session_sse(item)
            if sse_event:
                yield sse_event

    return EventSourceResponse(event_generator(), ping=15)


def to_session_sse(item: Union[Event, OutputDelta]) -> Optional[ServerSentEvent]:
    """落库事件带 seq 作为 SSE id；文本增量没有 id，重连不会补发。"""
    if isinstance(item, OutputDelta):
        return ServerSentEvent(
            event="delta",
            data=json.dumps({
                "session_id": item.session_id,
                "run_id": item.run_id,
                "turn": item.turn,
                "attempt": item.attempt,
                "delta": item.delta,
            }, ensure_ascii=False),
        )
    sse_event = EventMapper.event_to_sse_event(item)
    if not sse_event:
        return None
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
        project_service: ProjectService = Depends(get_project_service),
        config_service: AppConfigService = Depends(get_app_config_service),
) -> Response[GetSessionResponse]:
    """传递指定会话id获取该会话的对话详情"""
    detail = await session_service.get_session_detail(session_id, after_seq=after_seq, limit=limit)
    if not detail:
        raise NotFoundError("该会话不存在，请核实后重试")
    return Response.success(
        msg="获取会话详情成功",
        data=GetSessionResponse(
            session_id=detail.session.id,
            title=detail.session.title,
            status=detail.session.status,
            runs=[RunItem.from_run(run) for run in detail.runs],
            events=EventMapper.events_to_sse_events(detail.events),
            last_seq=detail.last_seq,
            context_operation=context_operation(session_id),
            context_config=await config_service.get_context_config(),
            project=project_service.describe(detail.session.project),
            project_start=ProjectStartObservation(
                initial_head=detail.session.project_snapshot.initial_head,
                initial_dirty=detail.session.project_snapshot.initial_dirty,
            ) if detail.session.project_snapshot else None,
        )
    )


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
        msg="重建请求成功",
        data=TurnRequestResponse(
            run_id=rebuilt.run_id,
            index=rebuilt.index,
            turn_seq=rebuilt.turn_seq,
            messages=rebuilt.messages,
            tools=rebuilt.tools,
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
    return Response.success(msg="停止任务会话成功", data={"run_id": run.id} if run else None)


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
        msg="获取会话文件列表成功",
        data=GetSessionFilesResponse(files=files)
    )


@router.post(
    path="/{session_id}/file",
    response_model=Response[FileReadResponse],
    summary="查看会话沙箱中指定文件的内容",
    description="根据传递的会话id+文件路径查看沙箱中文件的内容信息"
)
async def read_file(
        session_id: str,
        request: FileReadRequest,
        session_service: SessionService = Depends(get_session_service),
) -> Response[FileReadResponse]:
    """根据传递的会话id+文件路径查看沙箱中文件的内容信息"""
    result = await session_service.read_file(session_id, request.filepath)
    return Response.success(
        msg="获取会话文件内容成功",
        data=result
    )


@router.post(
    path="/{session_id}/shell",
    response_model=Response[ShellReadResponse],
    summary="查看会话的shell内容输出",
    description="传递指定会话id与shell会话标识，查看shell内容输出",
)
async def read_shell_output(
        session_id: str,
        request: ShellReadRequest,
        session_service: SessionService = Depends(get_session_service),
) -> Response[ShellReadResponse]:
    """查看会话的shell内容输出"""
    result = await session_service.read_shell_output(session_id, request.session_id)
    return Response.success(
        msg="获取Shell内容输出结果成功",
        data=result,
    )


@router.put(
    path="/{session_id}/project",
    response_model=Response[ProjectView],
    summary="绑定或更换会话项目",
    description="只能在首次运行前绑定或更换。会话不存在 404；共享沙箱模式、已有运行或已有沙箱 409；"
                "路径校验失败或未配置 PROJECT_ROOTS 返回 400。成功时 data 为 project 对象，path 是 realpath",
)
async def bind_project(
        session_id: str,
        request: BindProjectRequest,
        project_service: ProjectService = Depends(get_project_service),
) -> Response[ProjectView]:
    project = await project_service.bind(session_id, request.project_id)
    return Response.success(msg="已绑定项目", data=project)


@router.delete(
    path="/{session_id}/project",
    response_model=Response[Optional[ProjectView]],
    summary="解除会话项目绑定",
    description="只能在首次运行前解除。会话不存在 404；共享沙箱模式、已有运行或已有沙箱 409。成功时 data 为 null",
)
async def unbind_project(
        session_id: str,
        project_service: ProjectService = Depends(get_project_service),
) -> Response[Optional[ProjectView]]:
    await project_service.unbind(session_id)
    return Response(code=200, msg="已解除项目绑定", data=None)


@router.get(
    path="/{session_id}/project/tree",
    response_model=Response[ProjectListing],
    summary="列出项目目录的一层子项",
    description="path 为相对项目根的路径，省略时列出项目根。会话未绑定项目 404；路径校验失败 400。"
                "读的是 API 侧只读挂载，不依赖沙箱",
)
async def project_tree(
        session_id: str,
        path: str = Query(default=""),
        project_service: ProjectService = Depends(get_project_service),
) -> Response[ProjectListing]:
    listing = await project_service.tree(session_id, path)
    return Response.success(msg="获取项目目录成功", data=listing)


@router.get(
    path="/{session_id}/project/file",
    response_model=Response[ProjectFile],
    summary="读取项目内文件",
    description="二进制与超过上限的文件只返回元数据。会话未绑定项目 404；路径校验失败 400",
)
async def project_file(
        session_id: str,
        path: str = Query(),
        project_service: ProjectService = Depends(get_project_service),
) -> Response[ProjectFile]:
    project_file_result = await project_service.read_file(session_id, path)
    return Response.success(msg="读取项目文件成功", data=project_file_result)


@router.get(
    path="/{session_id}/project/git/status",
    response_model=Response[GitStatus],
    summary="读取项目 Git 状态",
    description="不是仓库或超时以 200 的 state 返回（not_a_repository / timeout），不当作错误。"
                "会话未绑定项目 404；路径校验失败 400",
)
async def project_git_status(
        session_id: str,
        project_service: ProjectService = Depends(get_project_service),
) -> Response[GitStatus]:
    status = await project_service.git_status(session_id)
    return Response.success(msg="获取 Git 状态成功", data=status)


@router.get(
    path="/{session_id}/project/git/diff",
    response_model=Response[GitDiff],
    summary="读取项目 Git diff",
    description="scope=worktree 为工作区相对暂存区，staged 为暂存区相对 HEAD。path 省略时取全部。"
                "不是仓库或超时以 200 的 state 返回。会话未绑定项目 404；路径校验失败 400",
)
async def project_git_diff(
        session_id: str,
        scope: str = Query(default="worktree"),
        path: Optional[str] = Query(default=None),
        project_service: ProjectService = Depends(get_project_service),
) -> Response[GitDiff]:
    diff = await project_service.git_diff(session_id, scope=scope, path=path)
    return Response.success(msg="获取 Git diff 成功", data=diff)


@router.websocket(
    path="/{session_id}/vnc",
)
async def vnc_websocket(
        websocket: WebSocket,
        session_id: str,
        session_service: SessionService = Depends(get_session_service),
) -> None:
    """VNC Websocket端点，用于建立与沙箱环境的vnc连接，并双向转发数据"""
    # 1.从客户端noVNC接收子协议
    protocols_str = websocket.headers.get("sec-websocket-protocol", "")
    protocols = [p.strip() for p in protocols_str.split(",")]

    # 2.判断使用不同协议(noVNC首选binary)
    selected_protocol = None
    if "binary" in protocols:
        selected_protocol = "binary"
    elif "base64" in protocols:
        selected_protocol = "base64"

    # 3.使用对应协议接收websocket连接
    logger.info(f"为会话[{session_id}]开启WebSocket连接")
    await websocket.accept(subprotocol=selected_protocol)

    try:
        # 4.获取对应会话的vnc链接
        sandbox_vnc_url = await session_service.get_vnc_url(session_id)
        logger.info(f"连接WebSocket VNC： {sandbox_vnc_url}")

        # 5.创建上下文并连接到vnc
        async with websockets.connect(sandbox_vnc_url) as sandbox_ws:
            # 6.创建两个异步协程来完成数据的双向转发
            async def forward_to_sandbox():
                try:
                    while True:
                        # 接收来自客户端的数据
                        data = await websocket.receive_bytes()
                        await sandbox_ws.send(data)
                except WebSocketDisconnect:
                    logger.info(f"Web->VNC连接终端")
                except Exception as forward_e:
                    logger.error(f"forward_to_sandbox出错: {str(forward_e)}")

            async def forward_from_sandbox():
                try:
                    while True:
                        # 接收来自沙箱的数据并转发
                        data = await sandbox_ws.recv()
                        await websocket.send_bytes(data)
                except ConnectionClosed:
                    logger.info("VNC->Web连接关闭")
                except Exception as forward_e:
                    logger.error(f"forward_from_sandbox出错: {str(forward_e)}")

            # 7.并行运行两个任务
            forward_task1 = asyncio.create_task(forward_to_sandbox())
            forward_task2 = asyncio.create_task(forward_from_sandbox())

            # 8.等待任意任务结束意味WebSocket连接终端
            done, pending = await asyncio.wait(
                [forward_task1, forward_task2],
                return_when=asyncio.FIRST_COMPLETED,
            )
            logger.info("WebSocket连接已关闭")

            # 9.如果任一任务完成则取消其他任务(关闭全部链接)
            for task in pending:
                task.cancel()
    except ConnectionError as connection_e:
        # 连接沙箱环境失败，关闭websocket
        logger.error(f"连接沙箱环境失败: {str(connection_e)}")
        await websocket.close(code=1011, reason=f"连接沙箱环境失败: {str(connection_e)}")
    except Exception as e:
        # 其他错误记录日志并关闭websocket
        logger.error(f"WebSocket异常: {str(e)}")
        await websocket.close(code=1011, reason=f"WebSocket异常: {str(e)}")
