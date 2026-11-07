"""工作区长期记忆：条目的创建、修改、确认、撤回、撤销与自动提炼结果的提交。

每个操作一个短写事务，条目、来源、变更记录与检索索引同事务提交。条目按 `version` 协调并发修改，
冲突返回最新版本；模型工具与提炼任务都经这里，工作区由调用方从会话解析，条目访问一律核对所属工作区。
"""
import hashlib
import json
import logging
from dataclasses import dataclass, field
from typing import Callable, Optional, Sequence

from app.application.errors.exceptions import BadRequestError, ConflictError, NotFoundError
from app.application.services.retrieval_service import RetrievalService
from app.domain.models.clock import utc_now
from app.domain.models.workspace import Workspace, WorkspaceStatus
from app.domain.models.workspace_memory import (
    EXTRACTION_STRATEGY_VERSION,
    MEMORY_CONTENT_MAX_CHARS,
    RESIDENT_MEMORY_LIMIT,
    ExtractionCommitStatus,
    ExtractionJob,
    MemoryCertainty,
    MemoryChange,
    MemoryChangeAction,
    MemoryEntry,
    MemoryOrigin,
    MemorySource,
    MemorySourceKind,
    MemoryStatus,
    MemorySuppression,
    MemoryType,
)
from app.domain.repositories.uow import IUnitOfWork
from app.domain.services.memory_rules import (
    ExtractionAction,
    ExtractionDecision,
    can_change_directly,
    content_fingerprint,
    select_resident,
)

logger = logging.getLogger(__name__)

# 一次提炼最多落地的条数：模型输出再多也不一次写入大量条目
EXTRACTION_MAX_ITEMS = 8
# 撤回前状态记在变更的 after_content 里，撤销时据此还原（候选或活动）
_STATUS_MARK = "@status="


@dataclass
class CommitResult:
    """提炼提交结果。status 为 rejected 时 reason 说明为何丢弃，其余字段为空。"""
    status: ExtractionCommitStatus
    reason: str = ""
    created: list[str] = field(default_factory=list)  # 直接生效的新条目
    updated: list[str] = field(default_factory=list)  # 直接更新的自动条目
    retracted: list[str] = field(default_factory=list)  # 直接删除（撤回）的自动条目
    candidates: list[str] = field(default_factory=list)  # 转为候选等待用户处理的条目
    skipped: int = 0


def checked_content(content: str) -> str:
    text = (content or "").strip()
    if not text:
        raise BadRequestError("记忆内容不能为空")
    if len(text) > MEMORY_CONTENT_MAX_CHARS:
        raise BadRequestError(f"记忆内容最多 {MEMORY_CONTENT_MAX_CHARS} 个字符")
    return text


def checked_type(value: MemoryType | str) -> MemoryType:
    try:
        return MemoryType(value)
    except ValueError as error:
        raise BadRequestError(f"未知的记忆类型：{value}") from error


class MemoryService:

    def __init__(self, uow_factory: Callable[[], IUnitOfWork], read_uow_factory: Optional[Callable[[], IUnitOfWork]],
                 retrieval: RetrievalService) -> None:
        self._uow_factory = uow_factory
        self._read_uow_factory = read_uow_factory or uow_factory
        self._retrieval = retrieval

    # ---- 内部：范围与版本核对 ----

    @staticmethod
    async def _workspace(uow: IUnitOfWork, workspace_id: str, *, write: bool) -> Workspace:
        workspace = await uow.workspace.get(workspace_id)
        if workspace is None or workspace.status is WorkspaceStatus.DELETING:
            raise NotFoundError("工作区不存在")
        if write and workspace.status is WorkspaceStatus.ARCHIVED:
            raise ConflictError("工作区已归档，记忆为只读；取消归档后再修改", resource_version=workspace.version)
        return workspace

    @staticmethod
    async def _scoped(uow: IUnitOfWork, workspace_id: str, memory_id: str) -> MemoryEntry:
        """条目必须属于这个工作区；别的工作区的条目对调用方等同不存在。"""
        entry = await uow.memory.get(memory_id)
        if entry is None or entry.workspace_id != workspace_id:
            raise NotFoundError("记忆不存在")
        return entry

    @staticmethod
    def _check_version(entry: MemoryEntry, expected: Optional[int]) -> None:
        if expected is not None and entry.version != expected:
            raise ConflictError("记忆已被修改，请刷新后重试", resource_version=entry.version)

    async def _change(self, uow: IUnitOfWork, before: Optional[MemoryEntry], after: MemoryEntry,
                      action: MemoryChangeAction, origin: MemoryOrigin, *, rationale: str = "",
                      request_id: Optional[str] = None, replaces: Optional[str] = None,
                      before_content: Optional[str] = None, after_content: Optional[str] = None) -> MemoryChange:
        change = MemoryChange(
            memory_id=after.id, workspace_id=after.workspace_id,
            from_version=before.version if before else None, to_version=after.version, action=action,
            origin=origin, rationale=rationale[:1000], request_id=request_id, replaces_change_id=replaces,
            before_content=before_content if before_content is not None else (before.content if before else None),
            after_content=after_content if after_content is not None else after.content)
        await uow.memory.add_change(change)
        return change

    async def _save(self, uow: IUnitOfWork, entry: MemoryEntry) -> MemoryEntry:
        await uow.memory.save(entry)
        await self._retrieval.index_memory(uow, entry)
        return entry

    @staticmethod
    def _bumped(entry: MemoryEntry, **values) -> MemoryEntry:
        return entry.model_copy(update={**values, "version": entry.version + 1, "updated_at": utc_now()})

    async def _find_active(self, uow: IUnitOfWork, workspace_id: str, fingerprint: str) -> Optional[MemoryEntry]:
        for item in await uow.memory.list(workspace_id, statuses=[MemoryStatus.ACTIVE]):
            if content_fingerprint(item.content) == fingerprint:
                return item
        return None

    @staticmethod
    async def _session_in_workspace(uow: IUnitOfWork, session_id: Optional[str], workspace_id: str) -> bool:
        if not session_id:
            return False
        session = await uow.session.get_by_id(session_id)
        return session is not None and session.workspace_id == workspace_id

    # ---- 创建：用户操作与用户要求下的 Agent 写入 ----

    async def create(
            self, workspace_id: str, content: str, memory_type: MemoryType | str = MemoryType.FACT, *,
            origin: MemoryOrigin = MemoryOrigin.USER, session_id: Optional[str] = None, pinned: bool = False,
            rationale: str = "", request_id: Optional[str] = None, source_seq_end: Optional[int] = None,
    ) -> MemoryEntry:
        """立即生效。用户操作标为用户确认；Agent 写入只标为材料陈述，不能经参数声称“用户确认”。
        同一工作区已有相同内容的活动条目时不重复创建：自动提炼产生的同内容条目被明确要求升级为对应来源。"""
        if origin not in (MemoryOrigin.USER, MemoryOrigin.AGENT_REQUESTED):
            raise BadRequestError("自动提炼的条目只能经提炼任务写入")
        text, kind = checked_content(content), checked_type(memory_type)
        certainty = MemoryCertainty.USER_CONFIRMED if origin is MemoryOrigin.USER else MemoryCertainty.MATERIAL_STATED
        fingerprint = content_fingerprint(text)
        async with self._uow_factory() as uow:
            await self._workspace(uow, workspace_id, write=True)
            from_session = await self._session_in_workspace(uow, session_id, workspace_id)
            if from_session:
                # 新的明确要求解除本会话对同一内容的来源抑制
                await uow.memory.clear_suppressions(workspace_id, session_id, fingerprint)
            existing = await self._find_active(uow, workspace_id, fingerprint)
            if existing is not None:
                if existing.is_user_protected:
                    return existing
                upgraded = self._bumped(existing, origin=origin, certainty=certainty,
                                        pinned=existing.pinned or pinned)
                await self._save(uow, upgraded)
                await self._change(uow, existing, upgraded, MemoryChangeAction.CONFIRM, origin,
                                   rationale=rationale or "明确要求记住", request_id=request_id)
                return upgraded
            entry = MemoryEntry(workspace_id=workspace_id, content=text, memory_type=kind, origin=origin,
                                certainty=certainty, status=MemoryStatus.ACTIVE, pinned=pinned)
            await uow.memory.add(entry)
            if from_session:
                seq_end = source_seq_end if source_seq_end is not None else await uow.event.max_seq(session_id)
                await uow.memory.add_source(MemorySource(
                    memory_id=entry.id, workspace_id=workspace_id, kind=MemorySourceKind.SESSION,
                    session_id=session_id, event_seq_end=seq_end))
            await self._change(uow, None, entry, MemoryChangeAction.CREATE, origin, rationale=rationale,
                               request_id=request_id)
            await self._retrieval.index_memory(uow, entry)
        return entry

    # ---- 读取 ----

    async def entries(self, workspace_id: str, statuses: Optional[Sequence[MemoryStatus]] = None) -> list[MemoryEntry]:
        async with self._read_uow_factory() as uow:
            await self._workspace(uow, workspace_id, write=False)
            return await uow.memory.list(workspace_id, statuses=statuses)

    async def get(self, workspace_id: str, memory_id: str) -> MemoryEntry:
        async with self._read_uow_factory() as uow:
            await self._workspace(uow, workspace_id, write=False)
            return await self._scoped(uow, workspace_id, memory_id)

    async def get_many(self, workspace_id: str, ids: Sequence[str]) -> list[MemoryEntry]:
        """同一工作区内的条目；不属于该工作区或不存在的身份被忽略。"""
        async with self._read_uow_factory() as uow:
            found = [await uow.memory.get(item) for item in ids]
        return [entry for entry in found if entry is not None and entry.workspace_id == workspace_id]

    async def resident(self, workspace_id: str, limit: int = RESIDENT_MEMORY_LIMIT) -> list[MemoryEntry]:
        """常驻层：钉住的先，其次类型（约束、偏好、决定先于事实），再按最近使用或更新。"""
        async with self._read_uow_factory() as uow:
            active = await uow.memory.list(workspace_id, statuses=[MemoryStatus.ACTIVE])
        return select_resident(active, limit)

    async def sources(self, workspace_id: str, memory_id: str) -> list[MemorySource]:
        """条目的来源；来源会话已不存在时如实标为不可用，不指向别处。"""
        async with self._read_uow_factory() as uow:
            await self._workspace(uow, workspace_id, write=False)
            await self._scoped(uow, workspace_id, memory_id)
            items = await uow.memory.list_sources(memory_id)
            checked: list[MemorySource] = []
            for item in items:
                if item.kind is MemorySourceKind.SESSION and item.session_id:
                    session = await uow.session.get_by_id(item.session_id)
                    item = item.model_copy(update={"available": session is not None and item.available})
                checked.append(item)
        return checked

    async def changes(self, workspace_id: str, memory_id: str) -> list[MemoryChange]:
        async with self._read_uow_factory() as uow:
            await self._workspace(uow, workspace_id, write=False)
            await self._scoped(uow, workspace_id, memory_id)
            return await uow.memory.list_changes(memory_id)

    async def mark_used(self, workspace_id: str, ids: Sequence[str]) -> None:
        """注入常驻层时记录最近使用；不递增版本，也不产生变更记录。"""
        if not ids:
            return
        async with self._uow_factory() as uow:
            now = utc_now()
            for memory_id in ids:
                entry = await uow.memory.get(memory_id)
                if entry is not None and entry.workspace_id == workspace_id:
                    await uow.memory.save(entry.model_copy(update={"last_used_at": now}))

    # ---- 用户对条目的操作 ----

    async def edit(self, workspace_id: str, memory_id: str, expected_version: Optional[int], *,
                   content: Optional[str] = None, memory_type: Optional[MemoryType | str] = None,
                   origin: MemoryOrigin = MemoryOrigin.USER, rationale: str = "") -> MemoryEntry:
        """用户修改内容或类型：修改后的条目是用户认可的，之后提炼不能直接覆盖。"""
        async with self._uow_factory() as uow:
            await self._workspace(uow, workspace_id, write=True)
            entry = await self._scoped(uow, workspace_id, memory_id)
            self._check_version(entry, expected_version)
            if entry.status in (MemoryStatus.RETRACTED, MemoryStatus.SUPERSEDED):
                raise ConflictError("该记忆已撤回或被替代，不能再修改", resource_version=entry.version)
            text = checked_content(content) if content is not None else entry.content
            kind = checked_type(memory_type) if memory_type is not None else entry.memory_type
            if text == entry.content and kind == entry.memory_type:
                return entry
            updated = self._bumped(entry, content=text, memory_type=kind, certainty=MemoryCertainty.USER_CONFIRMED)
            await self._save(uow, updated)
            await self._change(uow, entry, updated, MemoryChangeAction.UPDATE, origin, rationale=rationale)
        return updated

    async def set_pinned(self, workspace_id: str, memory_id: str, expected_version: Optional[int],
                         pinned: bool) -> MemoryEntry:
        async with self._uow_factory() as uow:
            await self._workspace(uow, workspace_id, write=True)
            entry = await self._scoped(uow, workspace_id, memory_id)
            self._check_version(entry, expected_version)
            if entry.status is not MemoryStatus.ACTIVE:
                raise ConflictError("只有活动的记忆可以钉住", resource_version=entry.version)
            if entry.pinned == pinned:
                return entry
            updated = self._bumped(entry, pinned=pinned)
            await self._save(uow, updated)
            await self._change(uow, entry, updated, MemoryChangeAction.PIN if pinned else MemoryChangeAction.UNPIN,
                               MemoryOrigin.USER)
        return updated

    async def confirm(self, workspace_id: str, memory_id: str, expected_version: Optional[int]) -> MemoryEntry:
        """候选经用户确认转为活动并标为用户确认；候选指向的旧条目随之被替代。"""
        async with self._uow_factory() as uow:
            await self._workspace(uow, workspace_id, write=True)
            entry = await self._scoped(uow, workspace_id, memory_id)
            self._check_version(entry, expected_version)
            if entry.status is not MemoryStatus.CANDIDATE:
                raise ConflictError("只有候选记忆需要确认", resource_version=entry.version)
            confirmed = self._bumped(entry, status=MemoryStatus.ACTIVE, certainty=MemoryCertainty.USER_CONFIRMED)
            await self._save(uow, confirmed)
            await self._change(uow, entry, confirmed, MemoryChangeAction.CONFIRM, MemoryOrigin.USER)
            if entry.supersedes_id:
                target = await uow.memory.get(entry.supersedes_id)
                if target is not None and target.workspace_id == workspace_id and target.status is MemoryStatus.ACTIVE:
                    replaced = self._bumped(target, status=MemoryStatus.SUPERSEDED, pinned=False)
                    await self._save(uow, replaced)
                    await self._change(uow, target, replaced, MemoryChangeAction.SUPERSEDE, MemoryOrigin.USER,
                                       rationale=f"被 {confirmed.id} 替代")
        return confirmed

    async def retract(self, workspace_id: str, memory_id: str, expected_version: Optional[int] = None, *,
                      origin: MemoryOrigin = MemoryOrigin.USER, rationale: str = "") -> MemoryEntry:
        """撤回：不再参与注入与召回，并为它的来源材料记录抑制，同一截止材料不再重复生成同样内容。"""
        async with self._uow_factory() as uow:
            await self._workspace(uow, workspace_id, write=True)
            entry = await self._scoped(uow, workspace_id, memory_id)
            self._check_version(entry, expected_version)
            if entry.status is MemoryStatus.RETRACTED:
                return entry
            updated = self._bumped(entry, status=MemoryStatus.RETRACTED, pinned=False)
            await self._save(uow, updated)
            await self._change(uow, entry, updated, MemoryChangeAction.RETRACT, origin, rationale=rationale,
                               after_content=f"{_STATUS_MARK}{entry.status.value}")
            fingerprint = content_fingerprint(entry.content)
            for source in await uow.memory.list_sources(entry.id):
                if source.kind is MemorySourceKind.SESSION and source.session_id and source.event_seq_end is not None \
                        and not await uow.memory.is_suppressed(
                            workspace_id, source.session_id, source.event_seq_end, fingerprint):
                    await uow.memory.add_suppression(MemorySuppression(
                        workspace_id=workspace_id, session_id=source.session_id,
                        source_seq_end=source.event_seq_end, content_fingerprint=fingerprint, memory_id=entry.id))
        return updated

    async def undo(self, workspace_id: str, memory_id: str, expected_version: Optional[int] = None) -> MemoryEntry:
        """撤销最近一次变更：产生一条新的撤销变更，不改写历史。创建、修改、撤回与钉住可撤销。"""
        async with self._uow_factory() as uow:
            await self._workspace(uow, workspace_id, write=True)
            entry = await self._scoped(uow, workspace_id, memory_id)
            self._check_version(entry, expected_version)
            changes = await uow.memory.list_changes(memory_id)
            last = changes[-1] if changes else None
            if last is None or last.to_version != entry.version:
                raise ConflictError("没有可撤销的变更", resource_version=entry.version)
            action = last.action
            if action is MemoryChangeAction.CREATE:
                reverted = self._bumped(entry, status=MemoryStatus.RETRACTED, pinned=False)
            elif action is MemoryChangeAction.UPDATE and last.before_content:
                reverted = self._bumped(entry, content=last.before_content)
            elif action is MemoryChangeAction.RETRACT:
                previous = (last.after_content or "")[len(_STATUS_MARK):] if (last.after_content or "").startswith(
                    _STATUS_MARK) else MemoryStatus.ACTIVE.value
                reverted = self._bumped(entry, status=MemoryStatus(previous))
            elif action in (MemoryChangeAction.PIN, MemoryChangeAction.UNPIN):
                reverted = self._bumped(entry, pinned=action is MemoryChangeAction.UNPIN)
            else:
                raise ConflictError("该变更不能撤销", resource_version=entry.version)
            await self._save(uow, reverted)
            await self._change(uow, entry, reverted, MemoryChangeAction.UNDO, MemoryOrigin.USER, replaces=last.id,
                               rationale=f"撤销 {action.value}")
            if action is MemoryChangeAction.RETRACT:
                fingerprint = content_fingerprint(reverted.content)
                for source in await uow.memory.list_sources(entry.id):
                    if source.session_id:
                        await uow.memory.clear_suppressions(workspace_id, source.session_id, fingerprint)
        return reverted

    # ---- 会话参与记忆 ----

    async def set_session_participation(self, session_id: str, participate: bool) -> bool:
        """会话是否参与记忆提炼与摘要检索；关闭时已索引的会话摘要同时撤出检索。独立对话恒不参与。"""
        async with self._uow_factory() as uow:
            session = await uow.session.get_by_id(session_id)
            if session is None:
                raise NotFoundError("会话不存在")
            if not session.workspace_id:
                raise BadRequestError("独立对话不写入记忆，没有可设置的选项")
            await uow.session.update_participation(session_id, participate)
            if not participate:
                await self._retrieval.remove_summary(uow, session.workspace_id, session_id)
        return participate

    # ---- 自动提炼：先登记代次，再提交结果 ----

    async def claim_extraction_in(self, uow: IUnitOfWork, workspace_id: str, session_id: str, source_seq_end: int,
                                  operation_id: str) -> ExtractionJob:
        """在调用方事务内先提交代次与材料截止位置；之后到达的旧代次结果会被丢弃。"""
        job = ExtractionJob(
            operation_id=operation_id, workspace_id=workspace_id, session_id=session_id,
            source_seq_end=source_seq_end, strategy_version=EXTRACTION_STRATEGY_VERSION,
            generation=await uow.memory.next_extraction_generation(session_id))
        await uow.memory.add_extraction(job)
        return job

    async def extraction_for_operation(self, operation_id: str) -> Optional[ExtractionJob]:
        async with self._read_uow_factory() as uow:
            return await uow.memory.get_extraction_by_operation(operation_id)

    @staticmethod
    async def _reject(uow: IUnitOfWork, job: ExtractionJob, reason: str) -> CommitResult:
        await uow.memory.save_extraction(job.model_copy(update={
            "commit_status": ExtractionCommitStatus.REJECTED, "updated_at": utc_now()}))
        return CommitResult(ExtractionCommitStatus.REJECTED, reason)

    async def commit_extraction(self, extraction_id: str, decisions: Sequence[ExtractionDecision]) -> CommitResult:
        """提交提炼结果。代次不是该会话最新、策略版本过期、会话不再参与记忆或工作区不可写时整体丢弃；
        其余按 D4 逐条落地：目标以提交时的当前状态为准，用户创建、要求写入、已确认或判定之后被修改过的条目一律转候选。"""
        async with self._uow_factory() as uow:
            job = await uow.memory.get_extraction(extraction_id)
            if job is None:
                raise NotFoundError("提炼任务不存在")
            if job.commit_status is not ExtractionCommitStatus.PENDING:
                return CommitResult(job.commit_status, "already_finished")
            workspace = await uow.workspace.get(job.workspace_id)
            if workspace is None or workspace.status is not WorkspaceStatus.ACTIVE:
                return await self._reject(uow, job, "workspace_unavailable")
            if job.strategy_version != EXTRACTION_STRATEGY_VERSION:
                return await self._reject(uow, job, "strategy_changed")
            if job.generation != await uow.memory.next_extraction_generation(job.session_id) - 1:
                return await self._reject(uow, job, "generation_mismatch")
            session = await uow.session.get_by_id(job.session_id)
            if session is None or session.workspace_id != job.workspace_id or not session.participate_in_memory:
                return await self._reject(uow, job, "session_not_participating")
            result = CommitResult(ExtractionCommitStatus.COMMITTED)
            for decision in list(decisions)[:EXTRACTION_MAX_ITEMS]:
                await self._apply_decision(uow, job, decision, result)
            identity = hashlib.sha256(json.dumps(
                [item.model_dump(mode="json") for item in decisions], ensure_ascii=False, sort_keys=True,
            ).encode()).hexdigest()
            await uow.memory.save_extraction(job.model_copy(update={
                "commit_status": ExtractionCommitStatus.COMMITTED, "result_identity": identity,
                "updated_at": utc_now()}))
        return result

    async def _new_auto(self, uow: IUnitOfWork, job: ExtractionJob, content: str, kind: MemoryType, *,
                        status: MemoryStatus, supersedes_id: Optional[str] = None, rationale: str = "") -> MemoryEntry:
        entry = MemoryEntry(
            workspace_id=job.workspace_id, content=content, memory_type=kind, origin=MemoryOrigin.AUTO_EXTRACTION,
            certainty=MemoryCertainty.MODEL_INFERRED, status=status, supersedes_id=supersedes_id)
        await uow.memory.add(entry)
        await uow.memory.add_source(MemorySource(
            memory_id=entry.id, workspace_id=job.workspace_id, kind=MemorySourceKind.SESSION,
            session_id=job.session_id, event_seq_end=job.source_seq_end))
        await self._change(uow, None, entry, MemoryChangeAction.CREATE, MemoryOrigin.AUTO_EXTRACTION,
                           rationale=rationale)
        await self._retrieval.index_memory(uow, entry)
        return entry

    async def _apply_decision(self, uow: IUnitOfWork, job: ExtractionJob, decision: ExtractionDecision,
                              result: CommitResult) -> None:
        if decision.action is ExtractionAction.NONE:
            result.skipped += 1
            return
        target: Optional[MemoryEntry] = None
        if decision.action in (ExtractionAction.UPDATE, ExtractionAction.DELETE):
            target = await uow.memory.get(decision.target_id) if decision.target_id else None
            if target is None or target.workspace_id != job.workspace_id or target.status is not MemoryStatus.ACTIVE:
                result.skipped += 1  # 目标不存在、属于别处或已不活动：不猜测
                return
        text = (decision.content or "").strip()
        if decision.action is ExtractionAction.DELETE and not text and target is not None:
            text = f"不再成立：{target.content}"[:MEMORY_CONTENT_MAX_CHARS]
        if not text:
            result.skipped += 1
            return
        text = text[:MEMORY_CONTENT_MAX_CHARS]
        fingerprint = content_fingerprint(text)
        if await uow.memory.is_suppressed(job.workspace_id, job.session_id, job.source_seq_end, fingerprint):
            result.skipped += 1  # 用户撤回过同一截止材料产生的同样内容
            return
        if decision.action is ExtractionAction.ADD:
            if await self._find_active(uow, job.workspace_id, fingerprint) is not None:
                result.skipped += 1
                return
            entry = await self._new_auto(uow, job, text, decision.memory_type, status=MemoryStatus.ACTIVE,
                                         rationale=decision.reason)
            result.created.append(entry.id)
            return
        assert target is not None
        fresh = decision.target_version is None or decision.target_version == target.version
        if can_change_directly(target) and fresh:
            if decision.action is ExtractionAction.UPDATE:
                updated = self._bumped(target, content=text, memory_type=decision.memory_type)
                await self._save(uow, updated)
                await self._change(uow, target, updated, MemoryChangeAction.UPDATE, MemoryOrigin.AUTO_EXTRACTION,
                                   rationale=decision.reason)
                result.updated.append(target.id)
            else:
                retracted = self._bumped(target, status=MemoryStatus.RETRACTED, pinned=False)
                await self._save(uow, retracted)
                await self._change(uow, target, retracted, MemoryChangeAction.RETRACT, MemoryOrigin.AUTO_EXTRACTION,
                                   rationale=decision.reason, after_content=f"{_STATUS_MARK}{target.status.value}")
                result.retracted.append(target.id)
            return
        # 用户保护的目标、已被修改的目标或判定依据过期：保存为候选，原条目不变
        for item in await uow.memory.list(job.workspace_id, statuses=[MemoryStatus.CANDIDATE]):
            if item.supersedes_id == target.id and content_fingerprint(item.content) == fingerprint:
                result.skipped += 1
                return
        candidate = await self._new_auto(uow, job, text, decision.memory_type, status=MemoryStatus.CANDIDATE,
                                         supersedes_id=target.id, rationale=decision.reason)
        result.candidates.append(candidate.id)
