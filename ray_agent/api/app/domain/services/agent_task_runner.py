#!/usr/bin/env python
# -*- coding: utf-8 -*-
import asyncio
import contextlib
import hashlib
import io
import json
import logging
import shutil
import time
import uuid
from pathlib import Path
from typing import AsyncGenerator, List, Callable, Optional, Protocol, Set, Tuple, Union

from fastapi import UploadFile

from app.domain.external.browser import Browser
from app.domain.external.file_storage import FileStorage
from app.domain.external.llm import LLM
from app.domain.external.workspace_files import FileKind, WorkspaceFileError
from app.domain.models.error import ErrorCode
from app.domain.external.search import SearchEngine
from app.domain.external.task import TaskRunner, Task
from app.domain.models.app_config import AgentConfig, ToolPolicyConfig
from app.domain.models.capability import Capability
from app.domain.models.event import ErrorEvent, MessageEvent, BaseEvent, ToolEvent, ToolEventStatus, \
    BrowserToolContent, SearchToolContent, ShellToolContent, FileToolContent, ProtocolToolContent, \
    TitleEvent, WaitEvent, DoneEvent, TurnEvent, TurnPhase, CleanupEvent, CleanupTarget, ApprovalEvent, \
    ApprovalStatus, CompactEvent, ContextEvent
from app.domain.models.file import File
from app.domain.models.identity import RootKind
from app.domain.models.message import Message
from app.domain.models.run import RunReason, RunStatus, tools_for_turn
from app.domain.models.run_input import RunInput
from app.domain.models.search import SearchResults
from app.domain.models.session import SessionStatus
from app.domain.models.tool_result import ToolResult
from app.domain.repositories.uow import IUnitOfWork
from app.domain.services.file_rules import denied_reason, safe_filename
from app.domain.services.file_scope import FileScope
from app.domain.services.flows.agent_loop import AGENT_MEMORY_NAME, AgentLoop, RunEndReason, build_default_tools
from app.domain.services.prompts.system import RuntimeEnvironment, build_system_prompt
from app.domain.services.run_ledger import RunLedger
from app.domain.services.session_locks import session_lock
from app.domain.services.task_error import format_public_error
from app.infrastructure.logging import set_log_session_id
from app.domain.services.tools.a2a import A2ATool
from app.domain.services.tools.mcp import MCPTool
from app.domain.services.tools.deliver import DeliveredFile

logger = logging.getLogger(__name__)

SHELL_EXECUTE_TOOL = "shell_execute"
STOP_SETTLE_SECONDS = 10.0  # 停止后等待执行协程退出的上限，A2A 的远端取消在协程退出过程中完成
_LOOP_TERMINALS = (DoneEvent, WaitEvent, ErrorEvent)


class RunWriteLeases(Protocol):
    """运行持有的工作区写入租约的收尾：停止时转 settling，确认执行协程退出后释放，期限内无法确认则转 blocked。"""

    async def begin_settle(self, run_id: str) -> None:
        ...

    async def finish_settle(self, run_id: str, confirmed: bool) -> list:
        ...


class _RunClosed(Exception):
    """运行已被停止或改为终态：本协程不再写入任何事件。"""


class AgentTaskRunner(TaskRunner):
    """执行一次运行：从持久输入取用户消息，驱动 Agent 循环并经运行账本写入事件。

    记忆随事件同事务保存；用户消息进入模型历史时，对应输入与那批上下文事件同事务标记消费。
    """
    _write_leases: Optional[RunWriteLeases] = None

    def __init__(
            self,
            uow_factory: Callable[[], IUnitOfWork],
            llm: LLM,
            agent_config: AgentConfig,
            mcp_tool: MCPTool,
            a2a_tool: A2ATool,
            session_id: str,
            file_storage: FileStorage,
            search_engine: SearchEngine,
            ledger: RunLedger,
            run_id: str,
            prior_status: Optional[SessionStatus] = None,  # 首条输入到达前会话所处的状态
            tool_policy: Optional[ToolPolicyConfig] = None,
            project_prompt: str = "",
            skill_runtime=None,
            workdir=None,  # 会话工作目录：附件、超长结果、截图与临时文件
            environment: Optional[RuntimeEnvironment] = None,
            web_reader=None,
            sandbox=None,  # ShellHost | None
            browser: Optional[Browser] = None,
            browser_session=None,  # LocalBrowserSession | None：运行结束时 stop
            approval: Optional[ApprovalEvent] = None,  # 审批续接时的答复；为空时从持久输入取第一条消息
            files: Optional[FileScope] = None,  # 文件工具与交付可访问的范围；为空时没有文件能力
            write_leases: Optional[RunWriteLeases] = None,
            workspace_memory=None,  # 已绑定工作区的记忆端口；只有工作区会话提供
            context_refresh=None,  # 续接前核对冻结背景：async (run_id) -> 新背景段或 None
            completion=None,  # 运行正常结束的钩子：on_run_completed(uow, session_id, run_id) 与 wake()
    ) -> None:
        self._uow_factory = uow_factory
        self._uow = uow_factory()
        self._session_id = session_id
        self._sandbox = sandbox
        self._files = files
        self._write_leases = write_leases
        self._context_refresh = context_refresh
        self._completion = completion
        self._mcp_tool = mcp_tool
        self._a2a_tool = a2a_tool
        self._file_storage = file_storage
        self._browser = browser
        self._browser_session = browser_session
        self._ledger = ledger
        self._run_id = run_id
        self._prior_status = prior_status
        self._approval = approval
        self._workdir = workdir
        self._claimed: Set[int] = set()
        self._next_turn = 1
        self._failure_reason: Optional[str] = None
        self._shell_sessions: List[str] = []  # 本次运行调用过 shell_execute 的 Shell 会话，停止时逐个终止
        self._screenshot_usage_loaded = False
        self._screenshot_count = 0
        self._screenshot_bytes = 0
        self._invoking = False
        self._settled = asyncio.Event()
        self._skill_runtime = skill_runtime
        environment = environment or RuntimeEnvironment()
        from app.domain.services.tools.skill import SkillTool
        self._flow = AgentLoop(
            uow_factory=uow_factory,
            llm=llm,
            agent_config=agent_config,
            session_id=session_id,
            tools=([SkillTool(self._skill_runtime)] if self._skill_runtime else []) + build_default_tools(
                sandbox=sandbox,
                files=files,
                browser=browser,
                search_engine=search_engine,
                mcp_tool=self._mcp_tool,
                a2a_tool=self._a2a_tool,
                default_exec_dir=str(workdir.path) if workdir else None,
                capture_screenshot=self._capture_screenshot,
                web_reader=web_reader,
                workspace_memory=workspace_memory,
            ),
            deliver_file=self._deliver_file if files is not None and environment.available(Capability.FILE_ACCESS) else None,
            write_output=self._write_output if workdir else None,
            output_dir=str(workdir.outputs) if workdir else None,
            system_prompt=build_system_prompt(environment),
            project_prompt=project_prompt,
            tool_policy=tool_policy,
        )
        self._flow.persist_memory_with_events = True
        self._flow._publish_delta = self._publish_delta
        self._flow.run_id = self._run_id
        self._flow.skill_runtime = self._skill_runtime
        if hasattr(llm, 'image_loader'):
            llm.image_loader = self._load_visual_image

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

    def _with_flow_state(self, apply=None, event: Optional[BaseEvent] = None):
        """在同一事务里附带保存记忆，并消费这批上下文对应的持久输入。返回事务回调与提交后的收尾。"""
        flow = self._flow
        memory = flow.memory.model_copy(deep=True) if flow.memory_dirty and flow.memory is not None else None
        input_ids = list(event._input_ids) if isinstance(event, ContextEvent) else []

        async def combined(uow: IUnitOfWork) -> None:
            if apply is not None:
                await apply(uow)
            if memory is not None:
                await uow.session.save_memory(self._session_id, AGENT_MEMORY_NAME, memory)
            if input_ids:
                await uow.run_input.consume(input_ids, event.seq)

        def committed() -> None:
            if memory is not None:
                flow.memory_dirty = False
            if input_ids:
                event._input_ids = []

        return combined, committed

    async def _persist(self, event: BaseEvent) -> None:
        """事件与它带来的会话字段、记忆与输入消费在同一事务写入；运行已是终态时停止本协程。"""
        apply = None
        if isinstance(event, TitleEvent):
            async def apply(uow: IUnitOfWork) -> None:
                await uow.session.update_title(self._session_id, event.title)
        elif isinstance(event, MessageEvent):
            async def apply(uow: IUnitOfWork) -> None:
                await uow.session.update_latest_message(self._session_id, event.message, event.created_at)
        combined, committed = self._with_flow_state(apply, event)
        written = await self._ledger.append(self._session_id, [event], run_id=self._run_id, apply=combined)
        if not written:
            raise _RunClosed()
        committed()

    async def _transition(self, status: RunStatus, reason: Optional[str] = None, *, apply=None, **kwargs):
        combined, committed = self._with_flow_state(apply)
        run = await self._ledger.transition(self._session_id, self._run_id, status, reason, apply=combined, **kwargs)
        if run is not None:
            committed()
        return run

    async def _next_input(self) -> Optional[Tuple[RunInput, Optional[MessageEvent]]]:
        """本运行下一条尚未取用的持久输入及其消息事件。"""
        async with self._uow_factory() as uow:
            pending = await uow.run_input.pending(self._run_id, exclude=self._claimed)
            if not pending:
                return None
            item = pending[0]
            event = await uow.event.get(self._session_id, item.message_seq)
        self._claimed.add(item.id)
        return item, event if isinstance(event, MessageEvent) else None

    async def _take_message(self) -> Optional[Message]:
        while (taken := await self._next_input()) is not None:
            item, event = taken
            if event is None or not event.message:
                logger.warning(f"会话[{self._session_id}] 输入[{item.id}]没有可用的消息正文，跳过")
                continue
            await self._place_attachments(event)
            return self._to_message(event, item.id)
        return None

    async def _place_attachments(self, event: MessageEvent) -> None:
        """把附件的内容对象复制到可访问的位置，成功后替换本次输入的附件路径；失败终止运行，不静默移出模型输入。
        工作区会话放进工作区文件夹根目录（同名不覆盖，用不冲突的名称），其余放进会话工作目录的 uploads。"""
        if self._workdir is None or not event.attachments:
            return
        placed: List[File] = []
        for attachment in event.attachments:
            try:
                placed.append(await self._place_attachment(attachment))
            except Exception as exc:
                logger.exception("附件放入工作目录失败 id=%s", attachment.id)
                raise RuntimeError(f"附件 {attachment.id} 放入会话工作目录失败；本次运行未完成，请核对后重试") from exc
        event.attachments = placed

    def _workspace_root(self):
        files = self._files
        if files is not None and files.working is not None and files.working.kind is RootKind.WORKSPACE_FOLDER:
            return files.working
        return None

    async def _place_attachment(self, attachment: File) -> File:
        source, file = await self._file_storage.download_file(attachment.id)
        try:
            name = safe_filename(file.filename or file.id)
            workspace = self._workspace_root()
            if workspace is not None and (reason := denied_reason((name,))):
                # 模型的文件工具读不了这类名字（凭据、数据库等），放进文件夹它也看不到：留在会话工作目录
                logger.info("附件 %s 命中文件夹禁止规则（%s），改放会话工作目录", file.id, reason)
                workspace = None
            if workspace is not None:
                placed = await self._place_in_workspace(workspace, source, file, name)
                if placed is not None:
                    return placed
            return await self._place_in_workdir(source, file, name)
        finally:
            source.close()

    async def _place_in_workspace(self, workspace, source, file: File, name: str) -> Optional[File]:
        """放进工作区文件夹；文件夹不可用时返回空，由调用方退回会话工作目录。"""
        from app.domain.models.identity import RootedPath
        async with self._uow_factory() as uow:
            session = await uow.session.get_by_id(self._session_id)
        previous = next((item for item in (session.files if session else [])
                         if item.id == file.id and item.root_id == workspace.root_id and item.relative_path), None)
        if previous is not None:
            try:
                entry = await self._files.files.stat(RootedPath(root_id=workspace.root_id,
                                                                relative_path=previous.relative_path))
                if entry.kind is FileKind.FILE:
                    return previous  # 重新取用同一条输入：附件已在文件夹里，不再放第二份
            except WorkspaceFileError:
                pass
        try:
            target, _ = await self._files.write_unique(RootedPath(root_id=workspace.root_id, relative_path=""),
                                                       name, source)
        except WorkspaceFileError as error:
            if error.code.value == "unavailable":
                logger.warning("工作区文件夹不可用，附件改放会话工作目录：%s", error)
                source.seek(0)
                return None
            raise
        placed = file.model_copy(update={"filepath": self._files.display(target), "root_id": target.root_id,
                                         "relative_path": target.relative_path})
        async with self._uow_factory() as uow:
            await uow.file.save(placed)
            await uow.session.add_file(self._session_id, placed)
        return placed

    async def _place_in_workdir(self, source, file: File, name: str) -> File:
        uploads = self._workdir.ensure().uploads
        target = uploads / name
        async with self._uow_factory() as uow:
            existing = await uow.session.get_file_by_path(self._session_id, str(target))
        if existing is not None and existing.id != file.id:
            stem, suffix = Path(name).stem, Path(name).suffix
            target = uploads / f"{stem[:180]}-{file.id}{suffix}"
        if existing is None or existing.id != file.id or not target.exists():
            def copy() -> None:
                partial = self._workdir.tmp / f"{uuid.uuid4().hex}.part"
                try:
                    with partial.open("wb") as output:
                        shutil.copyfileobj(source, output)
                    partial.replace(target)
                finally:
                    partial.unlink(missing_ok=True)
            await asyncio.to_thread(copy)
        placed = file.model_copy(update={"filepath": str(target)})
        async with self._uow_factory() as uow:
            await uow.file.save(placed)
            if existing is None or existing.id != file.id:
                await uow.session.add_file(self._session_id, placed)
        return placed

    async def _deliver_file(self, filepath: str) -> Union[File, DeliveredFile]:
        """deliver_files 的交付函数：可访问范围内的文件在交付时保存为内容对象并关联会话，之后再改文件不影响已交付版本。
        记录来源根与相对路径，供预览与打开位置使用。失败抛出异常，文本即错误原因。"""
        if self._files is None:
            raise RuntimeError("当前运行没有可访问的文件范围")
        scope = self._files
        rooted = scope.resolve(filepath)
        try:
            entry = await scope.files.stat(rooted)
        except WorkspaceFileError as error:
            if error.code is ErrorCode.NOT_FOUND:
                raise FileNotFoundError(f"不存在文件 {filepath}，请先写入文件再交付")
            raise
        if entry.kind is not FileKind.FILE:
            if entry.kind is FileKind.DIRECTORY:
                raise FileNotFoundError(f"{filepath} 是目录，不是文件，请交付其中的文件")
            raise WorkspaceFileError(ErrorCode.INVALID_REQUEST, f"{filepath} 不是普通文件（链接或特殊文件），不交付")
        resolved = scope.display(rooted)
        async with self._uow:
            old_file = await self._uow.session.get_file_by_path(self._session_id, resolved)
        sha = await scope.fingerprint(resolved)
        if old_file and old_file.sha256 == sha:
            return DeliveredFile(file=old_file, reused=True)
        reader = await scope.files.open_reader(rooted, entry.version)
        try:
            file = await self._file_storage.upload_file(
                UploadFile(file=reader, filename=Path(resolved).name, size=entry.version.size),
                session_id=self._session_id)
        finally:
            reader.close()
        file.filepath, file.sha256 = resolved, sha
        file.root_id, file.relative_path = rooted.root_id, rooted.relative_path
        async with self._uow:
            await self._uow.file.save(file)
            await self._uow.session.add_file(self._session_id, file)
        return file

    async def _write_output(self, filepath: str, content: str) -> None:
        """结果整形的落盘函数：超长工具结果的完整内容写入会话工作目录，失败抛出异常。"""
        path = Path(filepath)
        if not self._workdir.contains(path):
            raise ValueError(f"结果路径不在会话工作目录中：{filepath}")

        def write() -> None:
            self._workdir.ensure()
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding="utf-8")
        await asyncio.to_thread(write)

    async def _load_visual_image(self, ref):
        if ref.get('session_id') != self._session_id:
            raise ValueError('图片引用不属于当前会话')
        stream, file = await self._file_storage.download_file(ref['file_id'])
        try:
            if file.visual and file.visual.get('deleted_at'):
                raise ValueError('图片已过期，请重新观察')
            if ref.get('source') == 'user_attachment':
                from app.infrastructure.external.file_storage.image_input import read_image
                data, metadata = await asyncio.to_thread(read_image, stream)
                if metadata['original_sha256'] != ref['original_sha256'] or metadata['sha256'] != ref['sha256']:
                    raise ValueError('用户图片内容已变化，请重新上传')
                return data
            data = await asyncio.to_thread(stream.read, 2 * 1024 * 1024 + 1)
        finally:
            stream.close()
        if len(data) > 2 * 1024 * 1024 or hashlib.sha256(data).hexdigest() != ref['sha256']:
            raise ValueError('图片内容与已登记引用不一致')
        return data

    async def _capture_screenshot(self, *, purpose, scope, ref, tab_id, analyze=False, deliver=True) -> ToolResult:
        """显式留证：总预算包含捕获、写入工作目录与文件交付；没有隐式补图。"""
        usage = {'count':0, 'bytes':0}
        async def capture():
            if not self._screenshot_usage_loaded:
                async with self._uow:
                    events = await self._uow.event.list(self._session_id, types=['tool'], run_id=self._run_id)
                for event in events:
                    data = event.function_result.data if event.function_result else None
                    if event.function_name == 'browser_screenshot' and isinstance(data, dict):
                        used = data.get('screenshot_usage', {})
                        self._screenshot_count += used.get('count', 0)
                        self._screenshot_bytes += used.get('bytes', 0)
                self._screenshot_usage_loaded = True
            if self._screenshot_count >= 8 or self._screenshot_bytes >= 24 * 1024 * 1024:
                raise ValueError("本运行截图配额已用完（8 张 / 24 MiB）")
            self._screenshot_count += 1
            usage['count'] = 1
            visual_input = analyze and bool(getattr(self._flow._llm, 'supports_vision', False))
            options = dict(scope=scope, ref=ref, tab_id=tab_id)
            if visual_input:
                options['for_model'] = True
            image, metadata = await self._browser.capture_screenshot(**options)
            if self._screenshot_bytes + len(image) > 24 * 1024 * 1024:
                raise ValueError("截图超过本运行剩余字节配额")
            # 已捕获即扣配额，上传失败不允许无限重复生成。
            self._screenshot_bytes += len(image)
            usage['bytes'] = len(image)
            started = time.monotonic()
            mime = metadata.get('mime_type', 'image/png')
            extension = 'jpg' if mime == 'image/jpeg' else 'png'
            ownership = dict(session_id=self._session_id, run_id=self._run_id,
                tool_call_id=getattr(self, '_delivery_call_id', None), sha256=hashlib.sha256(image).hexdigest(),
                width=metadata['width'], height=metadata['height'], mime_type=mime, size=len(image),
                purpose=purpose, temporary=not deliver, expires_at=None if deliver else time.time()+86400,
                deleted_at=None)
            if deliver:
                if self._workdir is None:
                    raise ValueError('当前运行没有会话工作目录，截图无法交付')
                target = self._workdir.ensure().screenshots / self._run_id / f"{uuid.uuid4().hex}.{extension}"
                def write() -> None:
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(image)
                await asyncio.to_thread(write)
                delivered = await self._deliver_file(str(target))
                file = getattr(delivered, 'file', delivered)
            else:
                from starlette.datastructures import Headers
                file = await self._file_storage.upload_file(UploadFile(file=io.BytesIO(image),
                    filename=f'{uuid.uuid4().hex}.{extension}', size=len(image),
                    headers=Headers({'content-type': mime})), visual=ownership)
            metadata['stages_ms']['upload'] = int((time.monotonic()-started)*1000)
            metadata.update(screenshot=f'/api/files/{file.id}/download' if not deliver else self._file_storage.get_file_url(file),
                file_id=file.id, purpose=purpose,
                session_id=self._session_id, run_id=self._run_id, tool_call_id=ownership['tool_call_id'],
                visual_input=visual_input, screenshot_usage=usage, temporary=not deliver)
            if deliver:
                metadata['file'] = file.model_dump(mode='json')
            if visual_input:
                metadata['image_input'] = dict(ownership, file_id=file.id, token_estimate=1024,
                                               detail='high')
            message = '截图已交付为附件，无需再次 deliver_files。' if deliver else '临时观察图已保存，运行结束且满 24 小时后可回收。'
            message += '像素将在下一请求输入当前模型，请给出具体观察。' if visual_input else '当前没有向模型输入图像，仅留证；不能声称已做视觉判断。'
            return ToolResult(message=message, data=metadata)

        try:
            return await asyncio.wait_for(capture(), timeout=20)
        except Exception as exc:
            return ToolResult(success=False, message=str(exc) or '截图捕获与存储超过 20 秒总时限',
                              data={'screenshot_usage':usage})

    async def _handle_tool_event(self, event: ToolEvent) -> None:
        """只投影本次结果；不为展示重新读取执行环境。"""
        if event.status != ToolEventStatus.CALLED:
            return
        started = time.monotonic()
        try:
            result = event.function_result
            if result is None:
                return
            raw = event.raw_result
            data = raw.data if raw and isinstance(raw.data, dict) else {}
            shaped_data = result.data if isinstance(result.data, dict) else {}
            preview = shaped_data.get('content')
            if preview is None:
                preview = result.model_dump_json(indent=2)
            preview = str(preview)[:8000]
            if event.tool_name in ('browser', 'web'):
                if data.get('observation_status') == 'failed':
                    preview = (result.message or '') + '\n' + str(data.get('observation_error') or '')
                elif not result.success:
                    preview = result.message or '调用失败'
                elif not event.shaping and not data.get('content'):
                    if 'logs' in data:
                        preview = '\n'.join(f"[{r['level']}] {r['text']}" for r in data['logs']) or '当前范围内没有日志'
                    elif 'tabs' in data:
                        preview = '\n'.join(f"{r['title']} — {r['url']}" for r in data['tabs'])
                    elif data.get('interactive_elements'):
                        preview = '\n'.join(f"{r['name'] or r['tag']}：{r.get('value') or ''}" for r in data['interactive_elements'])
                    else:
                        preview = result.message or ('操作已完成' if data.get('action_success') else preview)
                preview = preview[:8000]
                event.tool_content = BrowserToolContent(
                    screenshot=data.get('screenshot'), content=preview, outcome=result,
                    url=data.get('final_url', data.get('url')), title=data.get('title'), tab_id=data.get('tab_id'),
                    observation_status=data.get('observation_status'),
                )
            elif event.tool_name == 'search' and raw and isinstance(raw.data, SearchResults):
                event.tool_content = SearchToolContent(results=raw.data.results)
            elif event.tool_name == 'shell':
                # console_records 已来自这次 shell 结果；长输出用整形后的预览。
                console = shaped_data.get('console_records', shaped_data.get('output', preview))
                if len(json.dumps(console, ensure_ascii=False)) > 8000:
                    console = preview
                event.tool_content = ShellToolContent(console=console, outcome=result)
            elif event.tool_name == 'file':
                event.tool_content = FileToolContent(content=preview, outcome=result)
            else:
                event.tool_content = ProtocolToolContent(outcome=result)
        finally:
            event.stages_ms['projection'] = int((time.monotonic()-started)*1000)

    @staticmethod
    def _to_message(event: MessageEvent, input_id: Optional[int] = None) -> Message:
        return Message(
            message=event.message or "",
            attachments=[attachment.filepath for attachment in event.attachments if attachment.filepath],
            images=event.image_inputs,
            image_mode=event.image_mode,
            skill=event.skill,
            image_input_note=event.image_input_note,
            input_id=input_id,
        )

    async def _drain_injected_messages(self) -> List[Message]:
        """取出运行中补充的全部用户消息，交给循环在下一次模型请求前追加。"""
        messages: List[Message] = []
        while (message := await self._take_message()) is not None:
            logger.info(f"会话[{self._session_id}] 运行中收到补充消息: {message.message[:50]}...")
            messages.append(message)
        return messages

    def _register_shell(self, event: ToolEvent) -> None:
        if event.status != ToolEventStatus.CALLING or event.function_name != SHELL_EXECUTE_TOOL:
            return
        shell_session = (event.function_args or {}).get("session_id")
        if isinstance(shell_session, str) and shell_session and shell_session not in self._shell_sessions:
            self._shell_sessions.append(shell_session)

    async def _process(self, message: Message, prior_status: Optional[SessionStatus]) -> BaseEvent:
        """运行一条用户消息，逐条写入事件；返回循环的终止事件（Done / Wait / Error），由调用方在会话锁内收尾。"""
        logger.info(f"会话[{self._session_id}] AgentTaskRunner接收到新消息: {message.message[:50]}...")
        return await self._drive(self._flow.invoke(
            message,
            drain_injected_messages=self._drain_injected_messages,
            prior_status=prior_status,
            first_turn_index=self._next_turn,
        ))

    async def _process_approval(self, event: ApprovalEvent) -> BaseEvent:
        """审批回复后续接同一运行：执行或拒绝该调用，再照常推进循环。"""
        logger.info(f"会话[{self._session_id}] AgentTaskRunner续接审批 call={event.tool_call_id} "
                    f"status={event.status.value}")
        return await self._drive(self._flow.resume_approval(
            event.tool_call_id,
            event.status,
            drain_injected_messages=self._drain_injected_messages,
            first_turn_index=self._next_turn,
            budget_used=await self._budget_used_before_approval(),
        ))

    async def _budget_used_before_approval(self) -> int:
        """本运行最近一条用户消息之后已发出的模型请求数（逐轮尝试与压缩摘要请求），续接审批时沿用。"""
        async with self._uow:
            history = await self._uow.event.list(self._session_id, types=["message", "turn", "compact"],
                                                 run_id=self._run_id)
        used = 0
        for item in history:
            if isinstance(item, MessageEvent) and item.role == "user":
                used = 0
            elif isinstance(item, TurnEvent) and item.phase == TurnPhase.COMPLETED:
                used += item.attempts or 0
            elif isinstance(item, CompactEvent):
                used += item.usage.attempts
        return used

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
                if loop_event.function_name in ('deliver_files', 'browser_screenshot') and loop_event.status == ToolEventStatus.CALLING:
                    self._delivery_call_id = loop_event.tool_call_id
                self._register_shell(loop_event)
                await self._handle_tool_event(loop_event)
                if loop_event.status == ToolEventStatus.CALLED and loop_event.function_name in ('discover_mcp_tools', 'get_remote_agent_cards', 'call_remote_agent'):
                    await self._record_tool_snapshot(self._next_turn)
            elif isinstance(loop_event, TurnEvent) and loop_event.phase == TurnPhase.STARTED:
                await self._record_tool_snapshot(loop_event.index)
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

        completion = getattr(self, "_completion", None)

        async def mark_unread(uow: IUnitOfWork) -> None:
            await uow.session.increment_unread_message_count(self._session_id)
            if completion is not None:
                # 摘要与记忆提炼任务与运行终态同事务登记：运行完成而任务丢失、或运行未完成却登记了任务都不会出现
                await completion.on_run_completed(uow, self._session_id, self._run_id)
        run = await self._transition(status, reason, events_before=[outcome],
                                     apply=mark_unread if status == RunStatus.COMPLETED else None)
        if run is not None and status == RunStatus.COMPLETED and completion is not None:
            completion.wake()

    async def _prepare_run(self) -> None:
        """按运行行设置运行模式并记录配置快照；续接已有运行时工具集若有变化，追加一条从下一轮生效的修订。"""
        async with self._uow:
            run = await self._uow.run.get(self._run_id)
        if run is None:
            raise RuntimeError(f"运行[{self._run_id}]不存在")
        self._flow.mode = run.mode
        self._next_turn = run.turns + 1
        stored = run.config_snapshot or {}
        if getattr(self, "_skill_runtime", None):
            await self._skill_runtime.initialize(frozen=bool(stored.get("skills_frozen")))
        configure = getattr(self._browser, 'configure_viewports', None)
        if callable(configure):
            async def save_viewports(records):
                async with self._uow_factory() as uow:
                    current = await uow.run.lock(self._run_id)
                    await uow.run.save_snapshot(self._run_id, {**(current.config_snapshot or {}), 'browser_viewports': records})
            await configure(self._run_id, stored.get('browser_viewports') or {}, save_viewports)
        external = stored.get('external_services') or {}
        for server in external.get('mcp', []):
            await self._mcp_tool.discover_mcp_tools(server)
        for agent_id in external.get('a2a', []):
            await self._a2a_tool.gateway.discover(agent_id)
        revised = False
        refresh = getattr(self, "_context_refresh", None)
        if stored.get("system_prompt") and refresh is not None and stored.get("project_prompt"):
            # 续接沿用冻结的背景；已撤回、被替代或随会话删除的内容优先于冻结引用，先从背景里移除
            refreshed = await refresh(self._run_id)
            frozen = stored["project_prompt"]
            if refreshed is not None and refreshed != frozen and frozen in stored["system_prompt"]:
                stored = {**stored, "project_prompt": refreshed,
                          "system_prompt": stored["system_prompt"].replace(frozen, refreshed, 1),
                          "context_revisions": [*(stored.get("context_revisions") or []),
                                                {"from_turn": self._next_turn, "reason": "unavailable_after_freeze"}]}
                revised = True
        if stored.get("system_prompt"):
            self._flow.request_system_prompt = stored["system_prompt"]
        if "project_prompt" in stored:
            self._flow.project_prompt = stored["project_prompt"]
        snapshot = await self._flow.config_snapshot()
        if getattr(self, "_skill_runtime", None):
            snapshot["skills_frozen"] = True
        if not stored.get("system_prompt"):
            from build_identity import read_manifest
            updated = {**stored, **snapshot, "api_build": read_manifest()}
        elif tools_for_turn(stored, self._next_turn) == snapshot["tools"]:
            if not revised:
                return
            updated = stored
        else:
            revisions = [*(stored.get("tool_revisions") or []),
                         {"from_turn": self._next_turn, "tools": snapshot["tools"]}]
            updated = {**stored, "tool_revisions": revisions}
        async with self._uow:
            await self._uow.run.save_snapshot(self._run_id, updated)

    async def _record_tool_snapshot(self, index):
        tools = self._flow.pipeline.schemas()
        mcp = getattr(self._mcp_tool, 'gateway', None)
        a2a = getattr(self._a2a_tool, 'gateway', None)
        external = {'mcp': list(getattr(mcp, 'tools', {}) or {}),
                    'a2a': list(getattr(a2a, 'agent_cards', {}) or {})}
        async with self._uow:
            run = await self._uow.run.get(self._run_id)
            if run is None:
                return
            stored = run.config_snapshot or {}
            if tools_for_turn(stored, index) == tools and stored.get('external_services') == external:
                return
            revisions = list(stored.get('tool_revisions', []))
            if tools_for_turn(stored, index) != tools:
                revisions = [r for r in revisions if r['from_turn'] < index]
                revisions.append({'from_turn': index, 'tools': tools})
            await self._uow.run.save_snapshot(self._run_id, {**stored, 'tool_revisions': revisions,
                                                            'external_services': external})

    async def stop_processes(self, run_id: str, settle_seconds: float = STOP_SETTLE_SECONDS) -> List[CleanupTarget]:
        """停止后的收尾：逐个终止登记的 Shell 会话，等待协程退出后收集 A2A 远端取消结果，写入一条 cleanup 事件。

        收尾失败只记录在事件里，不改变运行终态。
        """
        if getattr(self, "_skill_runtime", None):
            await self._skill_runtime.service.cancel_run(run_id)
        targets: List[CleanupTarget] = []
        if self._write_leases is not None:
            await self._write_leases.begin_settle(run_id)
        for shell_session in list(self._shell_sessions) if self._sandbox is not None else []:
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
        if self._write_leases is not None:
            try:
                await self._write_leases.finish_settle(run_id, confirmed=self._settled.is_set() or not self._invoking)
            except Exception:
                logger.exception(f"会话[{self._session_id}] 收尾写入租约失败")
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

        try:
            async with self._uow_factory() as uow:
                run = await uow.run.get(self._run_id)
            restore = getattr(self._browser, 'restore_viewports', None)
            if run and run.status.terminal and callable(restore):
                results = await restore()
                if results:
                    await self._ledger.append(self._session_id, [CleanupEvent(targets=[
                        CleanupTarget(kind='browser', id=r['tab_id'], success=r['success'], message=r['message'])
                        for r in results])], run_id=self._run_id, after_terminal=True)
        except Exception:
            logger.exception('恢复运行视口失败')

        cleanup = getattr(getattr(self, '_browser', None), 'cleanup', None)
        if callable(cleanup):
            try:
                await cleanup()
            except Exception as exc:
                logger.warning('清理浏览器连接失败: %s', exc)
        session = getattr(self, '_browser_session', None)
        if session is not None:
            try:
                await session.stop()
            except Exception as exc:
                logger.warning('停止浏览器会话失败: %s', exc)

    async def invoke(self, task: Optional[Task] = None) -> None:
        """处理本运行的输入并运行 Agent 循环；运行状态的每次变化都经由 RunLedger 与事件同事务写入。"""
        self._invoking = True
        try:
            set_log_session_id(self._session_id)
            logger.info(f"会话[{self._session_id}] AgentTaskRunner任务处理开始 run={self._run_id}")
            operations = [('prepare_run', self._prepare_run)]
            ensure = getattr(self._sandbox, 'ensure_sandbox', None)
            if self._sandbox is not None and callable(ensure) and not getattr(self._sandbox, 'lazy', False):
                operations.insert(0, ('sandbox', ensure))
            for stage, operation in operations:
                started = time.monotonic()
                try:
                    await operation()
                finally:
                    logger.info('run_stage run=%s stage=%s duration_ms=%d', self._run_id, stage,
                                int((time.monotonic()-started)*1000))

            prior_status = self._prior_status
            approval = self._approval if self._approval is not None and self._approval.status in (
                ApprovalStatus.APPROVED, ApprovalStatus.REJECTED) else None
            message = None if approval is not None else await self._take_message()
            if approval is None and message is None:
                self._failure_reason = RunReason.RUNNER_ERROR
                await self._finish(ErrorEvent(error="未收到任务消息"))
                return
            while True:
                if message is None:
                    outcome = await self._process_approval(approval)
                else:
                    outcome = await self._process(message, prior_status)
                # 收尾与“是否还有待处理输入”的判断和 chat 的路由在同一把会话锁内完成，消息不会落在两者之间
                async with session_lock(self._session_id):
                    message = await self._take_message()
                    if message is None:
                        await self._finish(outcome)
                        return
                    if isinstance(outcome, WaitEvent):
                        # 提问之后已到达的消息就是回复：运行经过 waiting 后继续。
                        # 等待审批时到达的消息（循环停下前注入）使审批失效，待审批的调用按等待规则补为未执行
                        pending = self._flow.pending_approval if self._waiting_approval else None
                        waited = await self._transition(
                            RunStatus.WAITING, RunReason.APPROVAL if pending is not None else None,
                            events_before=[outcome])
                        expired = [pending.decided(ApprovalStatus.EXPIRED)] if pending is not None else []
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
                await self._transition(RunStatus.FAILED, RunReason.RUNNER_ERROR,
                                       events_before=[ErrorEvent(error=format_public_error(e))],
                                       turn_closer=self.turn_snapshot)
            except Exception as persist_error:
                logger.warning(f"会话[{self._session_id}] 写入运行失败状态失败: {persist_error}")
        finally:
            self._settled.set()
            await self._release_write_leases()
            # 在同一个asyncio Task上下文中清理MCP/A2A工具资源
            # 这是关键：streamablehttp_client内部使用anyio.create_task_group()，
            # 要求在同一个Task中进入和退出cancel scope，
            # 所以必须在invoke()的finally块（即初始化MCP的同一个Task）中清理
            await self._cleanup_tools()

    async def _release_write_leases(self) -> None:
        """执行协程退出：本运行持有的租约不再有写入者，释放它们；租约身份按运行核对，不影响其他运行。"""
        if self._write_leases is None:
            return
        try:
            await self._write_leases.finish_settle(self._run_id, confirmed=True)
        except Exception:
            logger.exception(f"会话[{self._session_id}] 释放写入租约失败，将由停止收尾或启动扫描处理")

    async def destroy(self) -> None:
        """销毁任务运行器并释放资源"""
        destroy = getattr(self._sandbox, 'destroy', None) if self._sandbox else None
        if callable(destroy):
            await destroy()
        session = getattr(self, '_browser_session', None)
        if session is not None:
            with contextlib.suppress(Exception):
                await session.stop()
        await self._cleanup_tools()

    async def on_done(self, task: Task) -> None:
        logger.info(f"AgentTaskRunner任务执行结束")
