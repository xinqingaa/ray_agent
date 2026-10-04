#!/usr/bin/env python
# -*- coding: utf-8 -*-
import asyncio
import io
import json
import logging
import uuid
from typing import AsyncGenerator, List, Callable, BinaryIO, Optional, Union

from fastapi import UploadFile
from pydantic import TypeAdapter

from app.domain.external.browser import Browser
from app.domain.external.file_storage import FileStorage
from app.domain.external.llm import LLM
from app.domain.external.sandbox import Sandbox
from app.domain.external.search import SearchEngine
from app.domain.external.task import TaskRunner, Task
from app.domain.models.app_config import AgentConfig, ToolPolicyConfig
from app.domain.models.event import ErrorEvent, Event, MessageEvent, BaseEvent, ToolEvent, ToolEventStatus, \
    BrowserToolContent, SearchToolContent, ShellToolContent, FileToolContent, ProtocolToolContent, \
    TitleEvent, WaitEvent, DoneEvent, TurnEvent, TurnPhase, CleanupEvent, CleanupTarget, ApprovalEvent, \
    ApprovalStatus
from app.domain.models.file import File
from app.domain.models.message import Message
from app.domain.models.run import RunReason, RunStatus, tools_for_turn
from app.domain.models.search import SearchResults
from app.domain.models.session import SessionStatus
from app.domain.models.tool_result import ToolResult
from app.domain.repositories.uow import IUnitOfWork
from app.domain.services.flows.agent_loop import AgentLoop, RunEndReason, build_default_tools
from app.domain.services.prompts.system import build_system_prompt
from app.domain.services.run_ledger import RunLedger
from app.domain.services.session_locks import session_lock
from app.domain.services.task_error import format_public_error
from app.infrastructure.logging import set_log_session_id
from app.domain.services.tools.a2a import A2ATool
from app.domain.services.tools.mcp import MCPTool
from app.domain.services.tools.project_notes import ProjectNotesTool

logger = logging.getLogger(__name__)

SHELL_EXECUTE_TOOL = "shell_execute"
STOP_SETTLE_SECONDS = 10.0  # 停止后等待执行协程退出的上限，A2A 的远端取消在协程退出过程中完成
_LOOP_TERMINALS = (DoneEvent, WaitEvent, ErrorEvent)


class _RunClosed(Exception):
    """运行已被停止或改为终态：本协程不再写入任何事件。"""


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
            browser: Browser,  # 浏览器
            search_engine: SearchEngine,  # 搜索引擎
            sandbox: Sandbox,  # 沙箱
            ledger: RunLedger,  # 运行与事件的写入入口
            run_id: str,  # 本任务执行的运行
            prior_status: Optional[SessionStatus] = None,  # 首条消息到达前会话所处的状态
            tool_policy: Optional[ToolPolicyConfig] = None,  # 工具策略表，为空时用默认策略
            project_prompt: str = "",
            project_notes_update=None,
            workspace_dir: Optional[str] = None,  # 绑定项目时为 /workspace，否则为空
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
        self._ledger = ledger
        self._run_id = run_id
        self._prior_status = prior_status
        self._next_turn = 1
        self._failure_reason: Optional[str] = None
        self._shell_sessions: List[str] = []  # 本次运行调用过 shell_execute 的 Shell 会话，停止时逐个终止
        self._invoking = False
        self._settled = asyncio.Event()
        default_exec_dir = workspace_dir or "/home/ubuntu"
        self._flow = AgentLoop(
            uow_factory=uow_factory,
            llm=llm,
            agent_config=agent_config,
            session_id=session_id,
            tools=([ProjectNotesTool(project_notes_update)] if project_notes_update else []) + build_default_tools(
                sandbox=sandbox,
                browser=browser,
                search_engine=search_engine,
                mcp_tool=self._mcp_tool,
                a2a_tool=self._a2a_tool,
                default_exec_dir=default_exec_dir,
            ),
            deliver_file=self._deliver_file,
            write_output=self._write_output,
            system_prompt=build_system_prompt(workspace_dir),
            project_prompt=project_prompt,
            tool_policy=tool_policy,
        )
        self._flow._publish_delta = self._publish_delta

    @property
    def run_id(self) -> str:
        return self._run_id

    def turn_snapshot(self, index: int, error: str) -> Optional[TurnEvent]:
        """供停止接口补写被中止轮次的 completed，见 RunLedger.transition。"""
        return self._flow.turn_snapshot(index, error)

    def open_attempt_event(self):
        """供停止接口在运行仍活动时写下进行中的模型请求。"""
        return self._flow.open_attempt_event()

    async def _publish_delta(self, turn: int, attempt: int, delta: str) -> None:
        await self._ledger.publish_delta(self._session_id, self._run_id, turn, attempt, delta)

    async def _persist(self, event: BaseEvent) -> None:
        """事件与它带来的会话字段更新在同一事务写入；运行已是终态时停止本协程。"""
        apply = None
        if isinstance(event, TitleEvent):
            async def apply(uow: IUnitOfWork) -> None:
                await uow.session.update_title(self._session_id, event.title)
        elif isinstance(event, MessageEvent):
            async def apply(uow: IUnitOfWork) -> None:
                await uow.session.update_latest_message(self._session_id, event.message, event.created_at)
                await uow.session.increment_unread_message_count(self._session_id)
        if (isinstance(event, ToolEvent) and event.tool_name in ('shell', 'file', 'browser', 'mcp', 'a2a')
                and event.status == ToolEventStatus.CALLING and getattr(self, '_project_id', None)):
            previous_apply = apply
            async def apply(uow: IUnitOfWork) -> None:
                if previous_apply:
                    await previous_apply(uow)
                project = await uow.project.get(self._project_id, lock=True)
                if project:
                    project.files_size_stale = True
                    await uow.project.save(project)
        written = await self._ledger.append(self._session_id, [event], run_id=self._run_id, apply=apply)
        if not written:
            raise _RunClosed()

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

    async def _pop_message(self, task: Task) -> Optional[MessageEvent]:
        """取出输入流里的下一条用户消息；输入流为空时返回 None。"""
        while not await task.input_stream.is_empty():
            event = await self._pop_event(task)
            if isinstance(event, MessageEvent):
                return event
        return None

    async def _pop_first_input(self, task: Task) -> Optional[Union[MessageEvent, ApprovalEvent]]:
        """任务的第一条输入：用户消息，或审批回复（approved / rejected，由审批接口放入）。"""
        while not await task.input_stream.is_empty():
            event = await self._pop_event(task)
            if isinstance(event, MessageEvent):
                return event
            if isinstance(event, ApprovalEvent) and event.status in (ApprovalStatus.APPROVED, ApprovalStatus.REJECTED):
                return event
        return None

    async def _sync_file_to_sandbox(self, file_id: str, *, project_filename=None) -> File:
        """同步失败终止已受理运行，不能将失败附件静默移出模型输入。"""
        file_data = None
        try:
            file_data, file = await self._file_storage.download_file(file_id)
            # 附件名属于存储元数据，仍只允许一个文件名，不能改变沙箱目标目录。
            filename = (project_filename or file.filename).replace("\\", "/").split("/")[-1]
            if filename in ("", ".", "..") or "\x00" in filename:
                raise ValueError("附件名称无效")
            filepath = f"/home/ubuntu/upload/{filename}"
            result = await self._sandbox.upload_file(file_data=file_data, filepath=filepath, filename=filename)
            if not result.success:
                raise RuntimeError(result.message or "沙箱拒绝附件上传")
            copied = file.model_copy(update={"filepath": filepath})
            async with self._uow:
                await self._uow.file.save(copied)
            return copied
        except Exception as exc:
            logger.exception("附件同步失败 id=%s", file_id)
            raise RuntimeError(f"准备执行环境失败：附件 {file_id} 同步失败；本次运行未完成，请核对后重试") from exc
        finally:
            if file_data is not None:
                file_data.close()

    async def _sync_message_attachments_to_sandbox(self, event: MessageEvent) -> None:
        """先完整同步，成功后替换本次输入；失败保留原受理事件和附件 id。"""
        attachments: List[File] = []
        for attachment in event.attachments:
            project_id = getattr(self, '_project_id', None)
            service = getattr(self, '_project_attachment_service', None)
            if project_id and service:
                project_copy = await service.publish(project_id, attachment.id, self._run_id)
                copied = await self._sync_file_to_sandbox(attachment.id, project_filename=project_copy.path.rsplit('/', 1)[-1])
            else:
                copied = await self._sync_file_to_sandbox(attachment.id)
            async with self._uow:
                await self._uow.session.add_file(self._session_id, copied)
            attachments.append(copied)
        event.attachments = attachments

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

    async def _deliver_file(self, filepath: str) -> File:
        """deliver_files 的交付函数：校验沙箱文件存在，上传存储并关联会话。失败抛出异常，文本即错误原因。"""
        service = getattr(self, '_project_delivery_service', None)
        if service and getattr(self, '_project_id', None):
            return await service.deliver(self._project_id, self._session_id, self._run_id,
                getattr(self, '_delivery_call_id', None), filepath, self._sandbox)
        # 1.确认文件存在，避免把下载失败的底层报错当作原因
        exists_result = await self._sandbox.check_file_exists(filepath)
        exists = exists_result.data.get("exists") if isinstance(exists_result.data, dict) else False
        if not exists_result.success or not exists:
            raise FileNotFoundError(f"沙箱中不存在文件 {filepath}，请先写入文件再交付")

        # 2.根据文件路径从会话中查找旧记录
        async with self._uow:
            old_file = await self._uow.session.get_file_by_path(self._session_id, filepath)

        # 3.从沙箱中下载文件
        file_data = await self._sandbox.download_file(filepath)

        # 4.先上传新副本；上传失败时保留旧会话记录
        filename = filepath.split("/")[-1]
        file = await self._file_storage.upload_file(UploadFile(
            file=file_data,
            filename=filename,
            size=self._get_stream_size(file_data),
        ))
        file.filepath = filepath

        # 5.在同一事务中替换关联，按旧文件id删除，不删除存储副本或历史附件
        async with self._uow:
            if old_file:
                await self._uow.session.remove_file(self._session_id, old_file.id)
            await self._uow.session.add_file(self._session_id, file)
        return file

    async def _write_output(self, filepath: str, content: str) -> None:
        """结果整形的落盘函数：把超长工具结果的完整内容写入沙箱文件，失败抛出异常。"""
        result = await self._sandbox.write_file(filepath=filepath, content=content)
        if not result.success:
            raise RuntimeError(result.message or "沙箱写入失败")

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
            # 1.如果事件状态为已调用则执行以下代码；被策略禁止或被用户拒绝的调用没有执行，不读取沙箱生成展示内容
            if event.status == ToolEventStatus.CALLED and event.denied_by is None:
                # 2.工具为浏览器则补全工具浏览器工具内容
                if event.tool_name == "browser":
                    event.tool_content = BrowserToolContent(
                        screenshot=await self._get_browser_screenshot(),
                    )
                elif event.tool_name == "search":
                    # 3.工具为搜索则添加搜索工具内容；结果被整形时展示内容取整形前的结果
                    search_results: ToolResult[SearchResults] = event.raw_result
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
                    # 5.工具为file则只填充预览；会话文件列表只收录用户上传与 deliver_files 交付的文件
                    if "filepath" in event.function_args:
                        filepath = event.function_args["filepath"]
                        file_read_result = await self._sandbox.read_file(filepath)
                        file_content: str = (file_read_result.data or {}).get("content", "")
                        event.tool_content = FileToolContent(content=file_content)
                    else:
                        event.tool_content = FileToolContent(content="(No Content)")
                elif event.tool_name in ["mcp", "a2a"]:
                    # 协议结果展示进入上下文的内容：整形后是预览，完整内容路径在 event.shaping
                    if event.function_result is not None:
                        event.tool_content = ProtocolToolContent(outcome=event.function_result)
        except Exception as e:
            logger.exception(f"AgentTaskRunner生成工具内容失败: {str(e)}")

    @staticmethod
    def _to_message(event: MessageEvent) -> Message:
        return Message(
            message=event.message or "",
            attachments=[attachment.filepath for attachment in event.attachments],
        )

    async def _drain_injected_messages(self, task: Task) -> List[Message]:
        """取出运行中补充的全部用户消息，交给循环在下一次模型请求前追加。"""
        messages: List[Message] = []
        while not await task.input_stream.is_empty():
            event = await self._pop_event(task)
            if not isinstance(event, MessageEvent) or not event.message:
                continue
            await self._sync_message_attachments_to_sandbox(event)
            logger.info(f"会话[{self._session_id}] 运行中收到补充消息: {event.message[:50]}...")
            messages.append(self._to_message(event))
        return messages

    def _register_shell(self, event: ToolEvent) -> None:
        if event.status != ToolEventStatus.CALLING or event.function_name != SHELL_EXECUTE_TOOL:
            return
        shell_session = (event.function_args or {}).get("session_id")
        if isinstance(shell_session, str) and shell_session and shell_session not in self._shell_sessions:
            self._shell_sessions.append(shell_session)

    async def _process(self, event: MessageEvent, task: Task, prior_status: Optional[SessionStatus]) -> BaseEvent:
        """运行一条用户消息，逐条写入事件；返回循环的终止事件（Done / Wait / Error），由调用方在会话锁内收尾。"""
        await self._sync_message_attachments_to_sandbox(event)
        message = self._to_message(event)
        if not message.message:
            logger.warning(f"AgentTaskRunner接收了一条空消息")
            self._failure_reason = RunReason.RUNNER_ERROR
            return ErrorEvent(error="空消息错误")
        logger.info(f"会话[{self._session_id}] AgentTaskRunner接收到新消息: {message.message[:50]}...")

        drain = lambda: self._drain_injected_messages(task)
        return await self._drive(self._flow.invoke(
            message,
            drain_injected_messages=drain,
            prior_status=prior_status,
            first_turn_index=self._next_turn,
        ))

    async def _process_approval(self, event: ApprovalEvent, task: Task) -> BaseEvent:
        """审批回复后续接同一运行：执行或拒绝该调用，再照常推进循环。"""
        logger.info(f"会话[{self._session_id}] AgentTaskRunner续接审批 call={event.tool_call_id} "
                    f"status={event.status.value}")
        drain = lambda: self._drain_injected_messages(task)
        return await self._drive(self._flow.resume_approval(
            event.tool_call_id,
            event.status,
            drain_injected_messages=drain,
            first_turn_index=self._next_turn,
        ))

    @property
    def _waiting_approval(self) -> bool:
        return self._flow.end_reason == RunEndReason.APPROVAL

    async def _drive(self, events: AsyncGenerator[BaseEvent, None]) -> BaseEvent:
        """逐条写入循环事件，返回终止事件（Done / Wait / Error）。"""
        async for loop_event in events:
            if isinstance(loop_event, _LOOP_TERMINALS):
                if isinstance(loop_event, ErrorEvent):
                    reason = self._flow.end_reason
                    failed = reason is not None and reason not in (
                        RunEndReason.COMPLETED, RunEndReason.WAITING, RunEndReason.APPROVAL)
                    self._failure_reason = reason.value if failed else RunReason.RUNNER_ERROR
                return loop_event
            if isinstance(loop_event, ToolEvent):
                if loop_event.function_name == 'deliver_files' and loop_event.status == ToolEventStatus.CALLING:
                    self._delivery_call_id = loop_event.tool_call_id
                self._register_shell(loop_event)
                await self._handle_tool_event(loop_event)
            elif isinstance(loop_event, TurnEvent) and loop_event.phase == TurnPhase.STARTED:
                self._next_turn = loop_event.index + 1
            await self._persist(loop_event)
        self._failure_reason = RunReason.RUNNER_ERROR
        return ErrorEvent(error="Agent 循环未给出终止事件")

    async def _finish(self, outcome: BaseEvent) -> None:
        """没有待处理输入时，把循环的终止事件与运行状态变化写在同一事务里。"""
        if isinstance(outcome, DoneEvent):
            status, reason = RunStatus.COMPLETED, None
        elif isinstance(outcome, WaitEvent):
            status, reason = RunStatus.WAITING, RunReason.APPROVAL if self._waiting_approval else None
        else:
            status, reason = RunStatus.FAILED, self._failure_reason or RunReason.RUNNER_ERROR
        committed = await self._ledger.transition(self._session_id, self._run_id, status, reason, events_before=[outcome])
        memory = getattr(self, '_project_memory_service', None)
        if committed and status == RunStatus.COMPLETED and memory and getattr(self, '_project_id', None):
            asyncio.create_task(memory.auto_summary(self._session_id))

    async def _prepare_run(self) -> None:
        """按运行行设置运行模式并记录配置快照；续接已有运行时工具集若有变化，追加一条从下一轮生效的修订。"""
        async with self._uow:
            run = await self._uow.run.get(self._run_id)
        if run is None:
            raise RuntimeError(f"运行[{self._run_id}]不存在")
        self._flow.mode = run.mode
        self._next_turn = run.turns + 1
        stored = run.config_snapshot or {}
        if stored.get("system_prompt"):
            self._flow.request_system_prompt = stored["system_prompt"]
        if "project_prompt" in stored:
            self._flow.project_prompt = stored["project_prompt"]
        snapshot = await self._flow.config_snapshot()
        if not stored.get("system_prompt"):
            updated = {**stored, **snapshot}
        elif tools_for_turn(stored, self._next_turn) == snapshot["tools"]:
            return
        else:
            revisions = [*(stored.get("tool_revisions") or []),
                         {"from_turn": self._next_turn, "tools": snapshot["tools"]}]
            updated = {**stored, "tool_revisions": revisions}
        async with self._uow:
            await self._uow.run.save_snapshot(self._run_id, updated)

    async def stop_processes(self, run_id: str, settle_seconds: float = STOP_SETTLE_SECONDS) -> List[CleanupTarget]:
        """停止后的收尾：逐个终止登记的 Shell 会话，等待协程退出后收集 A2A 远端取消结果，写入一条 cleanup 事件。

        收尾失败只记录在事件里，不改变运行终态。
        """
        targets: List[CleanupTarget] = []
        for shell_session in list(self._shell_sessions):
            try:
                result = await self._sandbox.kill_process(shell_session)
                targets.append(CleanupTarget(kind="shell", id=shell_session, success=bool(result.success),
                                             message=result.message or ""))
            except Exception as e:
                logger.warning(f"会话[{self._session_id}] 终止Shell会话[{shell_session}]失败: {e}")
                targets.append(CleanupTarget(kind="shell", id=shell_session, success=False, message=str(e)))
        if self._invoking:
            try:
                await asyncio.wait_for(self._settled.wait(), settle_seconds)
            except asyncio.TimeoutError:
                logger.warning(f"会话[{self._session_id}] 停止后 {settle_seconds}s 内执行协程未退出")
        gateway = getattr(self._a2a_tool, "gateway", None)
        for agent_id, outcome in dict(getattr(gateway, "last_cancellations", None) or {}).items():
            targets.append(CleanupTarget(
                kind="a2a",
                id=str(agent_id),
                success=outcome.get("remote_cancel") == "canceled",
                message=json.dumps(outcome, ensure_ascii=False),
            ))
        if targets:
            try:
                await self._ledger.append(self._session_id, [CleanupEvent(targets=targets)], run_id=run_id,
                                          after_terminal=True)
            except Exception as e:
                logger.warning(f"会话[{self._session_id}] 写入停止收尾事件失败: {e}")
        return targets

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

    async def invoke(self, task: Task) -> None:
        """处理输入流里的消息并运行 Agent 循环；运行状态的每次变化都经由 RunLedger 与事件同事务写入。"""
        self._invoking = True
        try:
            # 1.确保沙箱、mcp、a2a均初始化完成，并记录运行的配置快照
            set_log_session_id(self._session_id)
            logger.info(f"会话[{self._session_id}] AgentTaskRunner任务处理开始 run={self._run_id}")
            await self._sandbox.ensure_sandbox()
            await self._mcp_tool.initialize()
            await self._a2a_tool.initialize()
            await self._prepare_run()

            # 2.逐条处理输入消息；运行中到达的消息由循环在模型请求前取走
            prior_status = self._prior_status
            first = await self._pop_first_input(task)
            if first is None:
                self._failure_reason = RunReason.RUNNER_ERROR
                await self._finish(ErrorEvent(error="未收到任务消息"))
                return
            event: Optional[MessageEvent] = first if isinstance(first, MessageEvent) else None
            while True:
                if event is None:
                    outcome = await self._process_approval(first, task)
                else:
                    outcome = await self._process(event, task, prior_status)
                # 3.收尾与“是否还有待处理输入”的判断和 chat 的路由在同一把会话锁内完成，消息不会落在两者之间
                async with session_lock(self._session_id):
                    event = await self._pop_message(task)
                    if event is None:
                        await self._finish(outcome)
                        return
                    if isinstance(outcome, WaitEvent):
                        # 提问之后已到达的消息就是回复：运行经过 waiting 后继续。
                        # 等待审批时到达的消息（循环停下前注入）使审批失效，待审批的调用按等待规则补为未执行
                        approval = self._flow.pending_approval if self._waiting_approval else None
                        waited = await self._ledger.transition(
                            self._session_id, self._run_id, RunStatus.WAITING,
                            RunReason.APPROVAL if approval is not None else None, events_before=[outcome])
                        expired = [approval.decided(ApprovalStatus.EXPIRED)] if approval is not None else []
                        if waited is None or await self._ledger.transition(
                                self._session_id, self._run_id, RunStatus.RUNNING, events_after=expired) is None:
                            raise _RunClosed()
                        prior_status = SessionStatus.WAITING
                    else:
                        # 完成或失败后仍有消息：同一运行继续处理，运行终态以最后一条消息的结果为准
                        await self._persist(outcome)
                        prior_status = SessionStatus.COMPLETED if isinstance(outcome, DoneEvent) \
                            else SessionStatus.FAILED
        except _RunClosed:
            logger.info(f"会话[{self._session_id}] 运行[{self._run_id}]已是终态，执行协程退出")
        except asyncio.CancelledError:
            # 停止接口已在同一事务里写好 cancelled 与终态事件；这里不再写库
            logger.info(f"会话[{self._session_id}] AgentTaskRunner任务运行取消")
            raise
        except Exception as e:
            logger.exception(f"会话[{self._session_id}] AgentTaskRunner运行出错: {str(e)}")
            try:
                await self._ledger.transition(
                    self._session_id, self._run_id, RunStatus.FAILED, RunReason.RUNNER_ERROR,
                    events_before=[ErrorEvent(error=format_public_error(e))],
                    turn_closer=self.turn_snapshot,
                )
            except Exception as persist_error:
                logger.warning(f"会话[{self._session_id}] 写入运行失败状态失败: {persist_error}")
        finally:
            from app.domain.services.project_file_coordinator import retire_writer, ProjectFileCoordinator
            project_id = getattr(self, '_project_id', None)
            retire_writer(project_id, getattr(self, '_project_writer_token', None))
            if project_id:
                try:
                    await (getattr(self, '_project_coordinator', None) or ProjectFileCoordinator(self._uow_factory, type(self._sandbox))).settle(project_id)
                except Exception:
                    logger.exception('项目环境收尾未完成')
            self._settled.set()
            # 在同一个asyncio Task上下文中清理MCP/A2A工具资源
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
