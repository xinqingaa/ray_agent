"""工作方式：版本发布、Agent 提议的确认与拒绝、模板。

发布与工作区当前版本指针在同一事务里更新，经 `workspace.update` 的 version 核对并发修改；
提议只在用户确认时发布，记忆提炼任务没有任何入口能改动这里。
"""
import logging
from typing import Any, Callable, Optional

from app.application.errors.exceptions import BadRequestError, ConflictError, NotFoundError
from app.domain.models.clock import utc_now
from app.domain.models.execution_settings import WORKSPACE_EXECUTION_KEY
from app.domain.models.working_style import (
    INSTRUCTION_MAX_CHARS,
    InstructionProposal,
    InstructionSource,
    InstructionVersionRecord,
    ProposalStatus,
    WorkingStyleTemplate,
)
from app.domain.models.workspace import Workspace, WorkspaceStatus
from app.domain.repositories.uow import IUnitOfWork

logger = logging.getLogger(__name__)

# 模板里允许携带的工具启用建议；只是建议，应用模板不会替用户打开任何开关
TOOL_SUGGESTION_KEYS = (WORKSPACE_EXECUTION_KEY,)
TEMPLATE_NAME_MAX_CHARS = 80


def checked_body(body: str) -> str:
    text = (body or "").strip()
    if len(text) > INSTRUCTION_MAX_CHARS:
        raise BadRequestError(f"工作方式最多 {INSTRUCTION_MAX_CHARS} 个字符，较长的方法与资料请放进文件夹")
    return text


def checked_name(name: str) -> str:
    cleaned = " ".join((name or "").split())
    if not cleaned:
        raise BadRequestError("模板名称不能为空")
    if len(cleaned) > TEMPLATE_NAME_MAX_CHARS:
        raise BadRequestError(f"模板名称最多 {TEMPLATE_NAME_MAX_CHARS} 个字符")
    return cleaned


def tool_suggestions_of(settings: Optional[dict[str, Any]]) -> dict[str, Any]:
    """只拷贝白名单里的布尔开关：不带路径、凭据、记忆或其他设置。"""
    source = settings or {}
    return {key: bool(source[key]) for key in TOOL_SUGGESTION_KEYS if isinstance(source.get(key), bool)}


async def _writable_workspace(uow: IUnitOfWork, workspace_id: str) -> Workspace:
    workspace = await uow.workspace.get(workspace_id)
    if workspace is None or workspace.status is WorkspaceStatus.DELETING:
        raise NotFoundError("工作区不存在")
    if workspace.status is WorkspaceStatus.ARCHIVED:
        raise ConflictError("工作区已归档，请取消归档后再修改工作方式", resource_version=workspace.version)
    return workspace


class WorkingStyleService:

    def __init__(self, uow_factory: Callable[[], IUnitOfWork],
                 read_uow_factory: Optional[Callable[[], IUnitOfWork]] = None) -> None:
        self._uow_factory = uow_factory
        self._read_uow_factory = read_uow_factory or uow_factory

    # ---- 读取 ----

    async def current(self, workspace_id: str) -> tuple[Workspace, Optional[InstructionVersionRecord]]:
        """工作区与它当前生效的工作方式版本；尚未设置时版本为空。"""
        async with self._read_uow_factory() as uow:
            workspace = await uow.workspace.get(workspace_id)
            if workspace is None or workspace.status is WorkspaceStatus.DELETING:
                raise NotFoundError("工作区不存在")
            record = await uow.instruction.get_version(workspace_id, workspace.instruction_version) \
                if workspace.instruction_version else await uow.instruction.latest(workspace_id)
        return workspace, record

    # ---- 发布 ----

    async def _publish_in(self, uow: IUnitOfWork, workspace: Workspace, body: str, source: InstructionSource,
                          proposal_id: Optional[str] = None) -> InstructionVersionRecord:
        """在写事务内追加新版本并移动当前版本指针；调用方已核对 workspace 的版本。"""
        latest = await uow.instruction.latest(workspace.id)
        next_version = max(workspace.instruction_version or 0, latest.version if latest else 0) + 1
        record = InstructionVersionRecord(workspace_id=workspace.id, version=next_version, body=body,
                                          source=source, proposal_id=proposal_id)
        await uow.instruction.add_version(record)
        updated = await uow.workspace.update(workspace.id, workspace.version, instruction_version=next_version)
        if updated is None:
            raise ConflictError("工作区已被修改，请刷新后重试", resource_version=workspace.version)
        return record

    async def publish(self, workspace_id: str, body: str, expected_version: Optional[int] = None,
                      source: InstructionSource = InstructionSource.USER_EDIT) -> InstructionVersionRecord:
        """用户编辑或套用模板：发布新版本。expected_version 是工作区的 version，不符返回冲突并带最新值。"""
        text = checked_body(body)
        async with self._uow_factory() as uow:
            workspace = await _writable_workspace(uow, workspace_id)
            if expected_version is not None and workspace.version != expected_version:
                raise ConflictError("工作区已被修改，请刷新后重试", resource_version=workspace.version)
            return await self._publish_in(uow, workspace, text, source)

    # ---- Agent 提议 ----

    async def propose(self, workspace_id: str, body: str, rationale: str = "",
                      session_id: Optional[str] = None) -> InstructionProposal:
        """Agent 生成新版本草案：只登记待确认的提议，不改变当前工作方式；同一工作区较早的待确认提议被替代。"""
        text = checked_body(body)
        async with self._uow_factory() as uow:
            workspace = await _writable_workspace(uow, workspace_id)
            for earlier in await uow.instruction.list_proposals(workspace_id, status=ProposalStatus.PENDING.value):
                await uow.instruction.save_proposal(earlier.model_copy(update={
                    "status": ProposalStatus.SUPERSEDED, "resolved_at": utc_now()}))
            proposal = InstructionProposal(
                workspace_id=workspace_id, base_version=max(workspace.instruction_version or 0, 1),
                body=text, rationale=(rationale or "").strip()[:1000], session_id=session_id)
            await uow.instruction.add_proposal(proposal)
        return proposal

    async def proposals(self, workspace_id: str, status: Optional[str] = None) -> list[InstructionProposal]:
        async with self._read_uow_factory() as uow:
            workspace = await uow.workspace.get(workspace_id)
            if workspace is None or workspace.status is WorkspaceStatus.DELETING:
                raise NotFoundError("工作区不存在")
            return await uow.instruction.list_proposals(workspace_id, status=status)

    async def _pending(self, uow: IUnitOfWork, workspace_id: str, proposal_id: str) -> InstructionProposal:
        proposal = await uow.instruction.get_proposal(proposal_id)
        if proposal is None or proposal.workspace_id != workspace_id:
            raise NotFoundError("提议不存在")
        if proposal.status is not ProposalStatus.PENDING:
            raise ConflictError(f"该提议已处理（当前状态：{proposal.status.value}）")
        return proposal

    async def accept(self, workspace_id: str, proposal_id: str) -> InstructionVersionRecord:
        """用户确认：发布新版本。提议基于的版本已被后来的修改替代时，提议作废并返回冲突，请用户重新审阅。"""
        stale: Optional[int] = None
        record: Optional[InstructionVersionRecord] = None
        async with self._uow_factory() as uow:
            workspace = await _writable_workspace(uow, workspace_id)
            proposal = await self._pending(uow, workspace_id, proposal_id)
            latest = await uow.instruction.latest(workspace_id)
            # 提议之后工作方式已发布过新版本（含“提议时尚未设置、之后才首次设置”的情形）即视为过期
            superseded = (workspace.instruction_version is not None
                          and proposal.base_version != workspace.instruction_version) or (
                latest is not None and latest.created_at > proposal.created_at)
            if superseded:
                await uow.instruction.save_proposal(proposal.model_copy(update={
                    "status": ProposalStatus.SUPERSEDED, "resolved_at": utc_now()}))
                stale = workspace.instruction_version
            else:
                record = await self._publish_in(uow, workspace, proposal.body, InstructionSource.CONFIRMED_PROPOSAL,
                                                proposal_id=proposal.id)
                await uow.instruction.save_proposal(proposal.model_copy(update={
                    "status": ProposalStatus.ACCEPTED, "resolved_at": utc_now()}))
        if record is None:
            raise ConflictError("工作方式在提议之后已变化，该提议已作废；请对照当前版本重新审阅",
                                resource_version=stale)
        return record

    async def reject(self, workspace_id: str, proposal_id: str) -> InstructionProposal:
        async with self._uow_factory() as uow:
            workspace = await uow.workspace.get(workspace_id)
            if workspace is None or workspace.status is WorkspaceStatus.DELETING:
                raise NotFoundError("工作区不存在")
            proposal = await self._pending(uow, workspace_id, proposal_id)
            rejected = proposal.model_copy(update={"status": ProposalStatus.REJECTED, "resolved_at": utc_now()})
            await uow.instruction.save_proposal(rejected)
        return rejected

    # ---- 模板 ----

    async def templates(self) -> list[WorkingStyleTemplate]:
        async with self._read_uow_factory() as uow:
            return await uow.instruction.list_templates()

    async def save_template(self, workspace_id: str, name: str, *,
                            include_tool_suggestions: bool = False) -> WorkingStyleTemplate:
        """从工作区另存为模板：只复制当前工作方式正文与可选的工具启用建议，不带记忆、路径、文件或凭据。"""
        title = checked_name(name)
        async with self._uow_factory() as uow:
            workspace = await uow.workspace.get(workspace_id)
            if workspace is None or workspace.status is WorkspaceStatus.DELETING:
                raise NotFoundError("工作区不存在")
            record = await uow.instruction.get_version(workspace_id, workspace.instruction_version) \
                if workspace.instruction_version else None
            template = WorkingStyleTemplate(
                name=title, body=record.body if record else "",
                tool_suggestions=tool_suggestions_of(workspace.settings) if include_tool_suggestions else {})
            await uow.instruction.add_template(template)
        return template

    async def rename_template(self, template_id: str, name: str) -> WorkingStyleTemplate:
        title = checked_name(name)
        async with self._uow_factory() as uow:
            template = await uow.instruction.get_template(template_id)
            if template is None:
                raise NotFoundError("模板不存在")
            renamed = template.model_copy(update={"name": title, "updated_at": utc_now()})
            await uow.instruction.save_template(renamed)
        return renamed

    async def delete_template(self, template_id: str) -> None:
        async with self._uow_factory() as uow:
            if await uow.instruction.get_template(template_id) is None:
                raise NotFoundError("模板不存在")
            await uow.instruction.remove_template(template_id)

    async def apply_template(self, workspace_id: str, template_id: str,
                             expected_version: Optional[int] = None) -> tuple[InstructionVersionRecord, WorkingStyleTemplate]:
        """应用模板就是发布一个来源为模板的新版本；模板里的工具建议随结果返回，由用户自行决定是否启用。"""
        async with self._uow_factory() as uow:
            workspace = await _writable_workspace(uow, workspace_id)
            if expected_version is not None and workspace.version != expected_version:
                raise ConflictError("工作区已被修改，请刷新后重试", resource_version=workspace.version)
            template = await uow.instruction.get_template(template_id)
            if template is None:
                raise NotFoundError("模板不存在")
            record = await self._publish_in(uow, workspace, checked_body(template.body), InstructionSource.TEMPLATE)
        return record, template
