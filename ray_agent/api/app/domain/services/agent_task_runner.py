#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
@Time    : 2025/05/22 0:52
@Author  : thezehui@gmail.com
@File    : agent_task_runner.py
"""
import asyncio
import io
import logging
import uuid
from typing import List, AsyncGenerator, Callable, BinaryIO, Optional

from fastapi import UploadFile
from pydantic import TypeAdapter

from app.domain.external.browser import Browser
from app.domain.external.file_storage import FileStorage
from app.domain.external.json_parser import JSONParser
from app.domain.external.llm import LLM
from app.domain.external.sandbox import Sandbox
from app.domain.external.search import SearchEngine
from app.domain.external.task import TaskRunner, Task
from app.domain.models.app_config import AgentConfig
from app.domain.models.event import ErrorEvent, Event, MessageEvent, BaseEvent, ToolEvent, ToolEventStatus, \
    BrowserToolContent, SearchToolContent, ShellToolContent, FileToolContent, ProtocolToolContent, \
    TitleEvent, WaitEvent, DoneEvent, UsageEvent
from app.domain.models.file import File
from app.domain.models.message import Message
from app.domain.models.search import SearchResults
from app.domain.models.session import SessionStatus
from app.domain.models.token_usage import (
    TokenUsageTotals,
    apply_usage_call,
    reset_turn,
    stamp_usage_event,
    totals_from_events,
)
from app.domain.models.tool_result import ToolResult
from app.domain.repositories.uow import IUnitOfWork
from app.domain.services.flows.planner_react import PlannerReActFlow
from app.domain.services.agents.step_guard import MISSING_ATTACHMENT_ERROR
from app.domain.services.task_error import format_public_error
from app.infrastructure.logging import set_log_session_id
from app.domain.services.tools.a2a import A2ATool
from app.domain.services.tools.mcp import MCPTool

logger = logging.getLogger(__name__)


class AgentTaskRunner(TaskRunner):
    """基于Agent智能体的任务运行器"""

    def __init__(
            self,
            uow_factory: Callable[[], IUnitOfWork],  # uow模块
            llm: LLM,  # 大语言模型
            agent_config: AgentConfig,  # 智能体配置
            mcp_tool: MCPTool,
            a2a_tool: A2ATool,
            session_id: str,  # 会话id
            file_storage: FileStorage,  # 文件存储桶
            json_parser: JSONParser,  # json解析器
            browser: Browser,  # 浏览器
            search_engine: SearchEngine,  # 搜索引擎
            sandbox: Sandbox,  # 沙箱
    ) -> None:
        """构造函数，完成Agent任务运行器的创建"""
        self._uow_factory = uow_factory
        self._uow = uow_factory()
        self._session_id = session_id
        self._sandbox = sandbox
        self._mcp_tool = mcp_tool
        self._a2a_tool = a2a_tool
        self._file_storage = file_storage
        self._browser = browser
        self._token_totals = TokenUsageTotals()
        self._flow = PlannerReActFlow(
            uow_factory=uow_factory,
            llm=llm,
            agent_config=agent_config,
            session_id=session_id,
            json_parser=json_parser,
            browser=browser,
            sandbox=sandbox,
            search_engine=search_engine,
            mcp_tool=self._mcp_tool,
            a2a_tool=self._a2a_tool,
        )

    async def _put_and_add_event(self, task: Task, event: Event) -> None:
        """往指定任务的消息队列中添加事件"""
        # 1.往任务的输出消息队列中新增事件
        event_id = await task.output_stream.put(event.model_dump_json())
        event.id = event_id

        # 2.将事件添加到对应的会话中
        async with self._uow:
            await self._uow.session.add_event(self._session_id, event)

    @classmethod
    async def _pop_event(cls, task: Task) -> Optional[Event]:
        """从任务的输入流中获取事件信息"""
        # 1.从任务task中读取数据
        event_id, event_str = await task.input_stream.pop()
        if event_str is None:
            logger.warning(f"AgentTaskRunner接收到空消息")
            return None

        # 2.使用pydantic+type类型将字符串转换成事件
        event = TypeAdapter(Event).validate_json(event_str)
        event.id = event_id

        return event

    async def _sync_file_to_sandbox(self, file_id: str) -> File:
        """根据文件id将文件同步到沙箱中"""
        try:
            # 1.调用文件存储下载文件信息
            file_data, file = await self._file_storage.download_file(file_id)

            # 2.组装沙箱文件路径
            filepath = f"/home/ubuntu/upload/{file.filename}"

            # 3.调用沙箱将文件上传至沙箱
            tool_result = await self._sandbox.upload_file(
                file_data=file_data,
                filepath=filepath,
                filename=file.filename
            )

            # 4.判断是否上传成功
            if tool_result.success:
                file.filepath = filepath
                async with self._uow:
                    await self._uow.file.save(file)  # 可以更新也可以不更新
                return file
        except Exception as e:
            logger.exception(f"AgentTaskRunner同步文件[{file_id}]失败: {str(e)}")

    async def _sync_message_attachments_to_sandbox(self, event: MessageEvent) -> None:
        """将消息事件中的附件同步到沙箱中"""
        # 1.定义附件列表
        attachments: List[str] = []

        try:
            # 2.判断消息中是否存在附件
            if event.attachments:
                # 3.循环遍历所有的消息附件
                for attachment in event.attachments:
                    # 4.根据同步文件的id将数据同步到沙箱中
                    file = await self._sync_file_to_sandbox(attachment.id)

                    # 5.文件是否同步成功
                    if file:
                        attachments.append(file)
                        async with self._uow:
                            await self._uow.session.add_file(self._session_id, file)

            # 6.更新消息事件中的attachments
            event.attachments = attachments
        except Exception as e:
            logger.exception(f"AgentTaskRunner同步消息附件到沙箱失败: {str(e)}")

    @classmethod
    def _get_stream_size(cls, f: BinaryIO) -> int:
        """根据传递的文件流，获取计算文件的大小"""
        # 1.记录当前文件指针位置
        current_pos = f.tell()

        # 2.将指针移动到文件末尾, seek，0: 偏移量、2: 相对文件末尾
        f.seek(0, 2)

        # 3.获取当前位置，也就是文件大小
        size = f.tell()

        # 4.恢复指针到原始位置
        f.seek(current_pos)

        return size

    async def _sync_file_to_storage(self, filepath: str) -> File:
        """将沙箱中指定的文件路径数据同步到存储桶中"""
        try:
            # 1.根据文件路径从会话中查找文件数据
            async with self._uow:
                file = await self._uow.session.get_file_by_path(self._session_id, filepath)

            # 2.从沙箱中下载文件
            file_data = await self._sandbox.download_file(filepath)

            # 3.判断会话中的文件是否存在
            if file:
                async with self._uow:
                    await self._uow.session.remove_file(self._session_id, file.filepath)

            # 4.提取文件名字、文件信息并更新文件路径
            filename = filepath.split("/")[-1]
            upload_file = UploadFile(
                file=file_data,
                filename=filename,
                size=self._get_stream_size(file_data),
            )

            # 5.上传文件到文件存储桶
            file = await self._file_storage.upload_file(upload_file)
            file.filepath = filepath

            # 6.往会话中新增一个文件信息
            async with self._uow:
                await self._uow.session.add_file(self._session_id, file)
            return file
        except Exception as e:
            logger.exception(f"AgentTaskRunner同步消息附件到文件存储桶失败: {str(e)}")

    async def _sync_message_attachments_to_storage(self, event: MessageEvent) -> None:
        """将消息事件的附件同步到文件存储桶中"""
        # 1.定义附件列表存储数据
        attachments: List[File] = []

        try:
            # 2.判断消息中是否存在附件
            if event.attachments:
                # 3.循环遍历所有附件
                for attachment in event.attachments:
                    # 4.根据文件路径将数据同步到文件存储桶
                    file = await self._sync_file_to_storage(attachment.filepath)
                    if file:
                        attachments.append(file)

            # 5.更新时间中的附件列表资源
            event.attachments = attachments
        except Exception as e:
            logger.exception(f"AgentTaskRunner同步消息附件到存储桶失败: {str(e)}")

    async def _get_browser_screenshot(self) -> str:
        """获取浏览器截图并返回截图文件对应的在线URL"""
        # 1.调用浏览器完成截图
        screenshot = await self._browser.screenshot()

        # 2.将浏览器截图上传到文件存储中
        file = await self._file_storage.upload_file(UploadFile(
            file=io.BytesIO(screenshot),
            filename=f"{str(uuid.uuid4())}.png",
            # bugfix:添加size尺寸
            size=self._get_stream_size(io.BytesIO(screenshot)),
        ))

        return self._file_storage.get_file_url(file)

    async def _handle_tool_event(self, event: ToolEvent) -> None:
        """额外处理工具消息，使其前端交互更友好"""
        try:
            # 1.如果事件状态为已调用则执行以下代码
            if event.status == ToolEventStatus.CALLED:
                # 2.工具为浏览器则补全工具浏览器工具内容
                if event.tool_name == "browser":
                    event.tool_content = BrowserToolContent(
                        screenshot=await self._get_browser_screenshot(),
                    )
                elif event.tool_name == "search":
                    # 3.工具为搜索则添加搜索工具内容
                    search_results: ToolResult[SearchResults] = event.function_result
                    logger.info(f"搜索工具结果: {search_results}")
                    event.tool_content = SearchToolContent(results=search_results.data.results)
                elif event.tool_name == "shell":
                    # 4.工具为shell则生成shell工具内容
                    if "session_id" in event.function_args:
                        shell_result = await self._sandbox.read_shell_output(
                            event.function_args["session_id"],
                            console=True,
                        )
                        event.tool_content = ShellToolContent(
                            console=(shell_result.data or {}).get("console_records", [])
                        )
                    else:
                        event.tool_content = ShellToolContent(console="(No console)")
                elif event.tool_name == "file":
                    # 5.工具为file则将文件同步到对象存储
                    if "filepath" in event.function_args:
                        filepath = event.function_args["filepath"]
                        file_read_result = await self._sandbox.read_file(filepath)
                        file_content: str = (file_read_result.data or {}).get("content", "")
                        event.tool_content = FileToolContent(content=file_content)
                        # bugfix:修改为同步文件到storage
                        await self._sync_file_to_storage(filepath)
                    else:
                        event.tool_content = FileToolContent(content="(No Content)")
                elif event.tool_name in ["mcp", "a2a"]:
                    if event.function_result is not None:
                        event.tool_content = ProtocolToolContent(outcome=event.function_result)
        except Exception as e:
            logger.exception(f"AgentTaskRunner生成工具内容失败: {str(e)}")

    async def _run_flow(self, message: Message) -> AsyncGenerator[BaseEvent, None]:
        """根据消息对象运行PlannerReActFlow"""
        # 1.判断传递的消息是否为空
        if not message.message:
            logger.warning(f"AgentTaskRunner接收了一条空消息")
            yield ErrorEvent(error="空消息错误")
            return

        # 2.调用流并运行获取事件信息
        async for event in self._flow.invoke(message):
            # 3.判断是否为工具事件，如果是则额外处理
            if isinstance(event, ToolEvent):
                await self._handle_tool_event(event)
            elif isinstance(event, MessageEvent):
                # 4.如果是消息事件则将AI消息事件中的附件同步到存储中
                claimed = [
                    attachment.filepath
                    for attachment in (event.attachments or [])
                    if getattr(attachment, "filepath", None)
                ]
                await self._sync_message_attachments_to_storage(event)
                if claimed and not event.attachments:
                    yield event
                    yield ErrorEvent(error=MISSING_ATTACHMENT_ERROR)
                    continue
            elif isinstance(event, UsageEvent):
                apply_usage_call(self._token_totals, event)
                event = stamp_usage_event(event, self._token_totals)

            # 5.将事件直接返回
            yield event

    def _schedule_detached(self, coro) -> None:
        """把收尾写库放到新 Task，避开当前 Task 上的 cancel scope。"""
        try:
            asyncio.get_running_loop().create_task(coro)
        except RuntimeError:
            logger.warning(f"会话[{self._session_id}] 事件循环已关闭，无法后台持久化")
            coro.close()

    async def _persist_terminal_state(
            self,
            task: Task,
            status: SessionStatus,
            event: Event,
    ) -> None:
        """用全新 UoW 写入终态事件和会话状态，不复用可能已被取消的连接。"""
        try:
            event_id = await task.output_stream.put(event.model_dump_json())
            event.id = event_id
            uow = self._uow_factory()
            async with uow:
                await uow.session.add_event(self._session_id, event)
                await uow.session.update_status(self._session_id, status)
        except Exception as e:
            logger.warning(f"会话[{self._session_id}] 任务终态持久化失败: {e}")

    async def _cleanup_tools(self) -> None:
        """关闭外部协议资源；MCP 上下文由各自连接任务负责退出。"""
        try:
            if self._mcp_tool:
                await self._mcp_tool.cleanup()
        except Exception as e:
            logger.warning(f"清理MCP工具资源时出错: {e}")
        try:
            if self._a2a_tool:
                await self._a2a_tool.cleanup()
        except Exception as e:
            logger.warning(f"清理A2A工具资源时出错: {e}")

    async def _restore_token_totals(self) -> None:
        """从已保存事件恢复会话/本轮累计，避免新任务实例把历史用量清零。"""
        async with self._uow:
            session = await self._uow.session.get_by_id(self._session_id)
        events = session.events if session else []
        self._token_totals = totals_from_events(events)

    async def invoke(self, task: Task) -> None:
        """根据传递的任务处理agent消息队列并运行agent流"""
        try:
            # 1.确保沙箱、mcp、a2a均初始化完成
            set_log_session_id(self._session_id)
            logger.info(f"会话[{self._session_id}] AgentTaskRunner任务处理开始")
            await self._sandbox.ensure_sandbox()
            await self._mcp_tool.initialize()
            await self._a2a_tool.initialize()
            await self._restore_token_totals()

            had_error = False
            # 2.循环读取任务中的输入消息队列
            while not await task.input_stream.is_empty():
                # 3.从输入流中获取数据
                event = await self._pop_event(task)
                if event is None:
                    continue
                message = ""

                # 4.判断事件类型是否为消息事件，如果是则处理消息并将附件同步到沙箱中
                if isinstance(event, MessageEvent):
                    message = event.message or ""
                    await self._sync_message_attachments_to_sandbox(event)
                    logger.info(f"会话[{self._session_id}] AgentTaskRunner接收到新消息: {message[:50]}...")
                    reset_turn(self._token_totals)

                # 5.将消息事件转换称消息对象
                message_obj = Message(
                    message=message,
                    attachments=[attachment.filepath for attachment in event.attachments]
                )

                # 6.传递消息对象并运行PlannerReActFlow
                async for event in self._run_flow(message_obj):
                    # 7.将得到的事件添加到消息队列中
                    await self._put_and_add_event(task, event)
                    if isinstance(event, ErrorEvent):
                        had_error = True

                    # 8.如果事件类型为标题事件则更新会话标题
                    if isinstance(event, TitleEvent):
                        async with self._uow:
                            await self._uow.session.update_title(self._session_id, event.title)
                    elif isinstance(event, MessageEvent):
                        # 9.如果事件为消息事件，则更新最新消息并新增未读消息数
                        async with self._uow:
                            await self._uow.session.update_latest_message(
                                self._session_id,
                                event.message,
                                event.created_at,
                            )
                            await self._uow.session.increment_unread_message_count(self._session_id)
                    elif isinstance(event, WaitEvent):
                        # 10.如果事件为等待，则更新会话状态并终止程序
                        async with self._uow:
                            await self._uow.session.update_status(self._session_id, SessionStatus.WAITING)
                        return

                    # 11.判断如果输入消息队列为空则跳出循环
                    if not await task.input_stream.is_empty():
                        break

            # 12.有错误事件则标失败，同一会话仍可再发消息重跑
            async with self._uow:
                await self._uow.session.update_status(
                    self._session_id,
                    SessionStatus.FAILED if had_error else SessionStatus.COMPLETED,
                )
        except asyncio.CancelledError:
            # 13.当前 Task 已被取消（例如 stop_session），不能再 await 同一条连接。
            # 终态写入放到新 Task，否则连接无法还回池子。
            logger.info(f"会话[{self._session_id}] AgentTaskRunner任务运行取消")
            self._schedule_detached(
                self._persist_terminal_state(task, SessionStatus.COMPLETED, DoneEvent())
            )
            raise
        except Exception as e:
            # 14.记录日志并往任务队列/消息队列中写入异常事件并更新会话状态
            logger.exception(f"会话[{self._session_id}] AgentTaskRunner运行出错: {str(e)}")
            await self._put_and_add_event(task, ErrorEvent(error=format_public_error(e)))
            async with self._uow:
                await self._uow.session.update_status(self._session_id, SessionStatus.FAILED)
        finally:
            # 15.在同一个asyncio Task上下文中清理MCP/A2A工具资源
            # 这是关键：streamablehttp_client内部使用anyio.create_task_group()，
            # 要求在同一个Task中进入和退出cancel scope，
            # 所以必须在invoke()的finally块（即初始化MCP的同一个Task）中清理
            await self._cleanup_tools()

    async def destroy(self) -> None:
        """销毁任务运行器并释放资源"""
        # 1.清除沙箱
        logger.info(f"开始清除销毁AgentTaskRunner资源")
        if self._sandbox:
            logger.info("销毁AgentTaskRunner中的沙箱环境")
            await self._sandbox.destroy()

        # 2.清除mcp和a2a工具（幂等操作，如果invoke()中已清理则不会重复执行）
        await self._cleanup_tools()

    async def on_done(self, task: Task) -> None:
        """任务结束时执行的回调函数"""
        logger.info(f"AgentTaskRunner任务执行结束")
