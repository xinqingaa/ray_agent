"""自动提炼的生效规则（D4）、迟到结果、抑制，以及摘要与提炼任务的代次核对。模型端用注入的替身。"""
from datetime import timedelta

import pytest

from app.application.errors.exceptions import ConflictError
from app.application.services.memory_extractor import ProposedFact
from app.application.services.memory_jobs import (
    clip_material, enqueue_post_run_jobs, memory_extraction_handler, session_summary_handler,
)
from app.application.services.session_summary import SummaryUnavailable
from app.domain.models.clock import utc_now
from app.domain.models.operation import OperationKind
from app.domain.models.session_summary_record import SummaryState
from app.domain.models.workspace_memory import (
    ExtractionCommitStatus, MemoryCertainty, MemoryEntry, MemoryOrigin, MemoryStatus, MemoryType,
    RESIDENT_MEMORY_LIMIT,
)
from app.domain.services.memory_rules import (
    ExtractionAction, ExtractionDecision, can_change_directly, content_fingerprint, parse_decisions, select_resident,
)
from tests.support.memory_env import JobStub, MemEnv
from tests.support.sqlite_db import with_database


def scenario(tmp_path, body):
    async def run(uow_factory, read_factory, database):
        await body(MemEnv(uow_factory, read_factory))
    with_database(tmp_path, run)


def decision(action, content="", target=None, *, version=None, kind=MemoryType.FACT):
    return ExtractionDecision(action=action, content=content, target_id=target.id if target else None,
                              target_version=version, memory_type=kind)


async def claim(env: MemEnv, workspace_id, session_id, seq, operation="op"):
    async with env.uow_factory() as uow:
        return await env.memory.claim_extraction_in(uow, workspace_id, session_id, seq, f"{operation}-{seq}-{utc_now()}")


# ---- 纯规则 ----

def test_only_unconfirmed_auto_entries_can_be_changed_directly():
    base = dict(workspace_id="w", content="x", memory_type=MemoryType.FACT)
    auto = MemoryEntry(origin=MemoryOrigin.AUTO_EXTRACTION, certainty=MemoryCertainty.MODEL_INFERRED, **base)
    assert can_change_directly(auto)
    assert not can_change_directly(auto.model_copy(update={"certainty": MemoryCertainty.USER_CONFIRMED}))
    assert not can_change_directly(auto.model_copy(update={"status": MemoryStatus.CANDIDATE}))
    for origin in (MemoryOrigin.USER, MemoryOrigin.AGENT_REQUESTED):
        assert not can_change_directly(auto.model_copy(update={"origin": origin}))
    assert not can_change_directly(None)


def test_resident_selection_pins_first_then_type_then_recency():
    now = utc_now()

    def entry(name, kind, *, pinned=False, age=0, status=MemoryStatus.ACTIVE):
        return MemoryEntry(id=name, workspace_id="w", content=name, memory_type=kind, status=status, pinned=pinned,
                           origin=MemoryOrigin.USER, certainty=MemoryCertainty.USER_CONFIRMED,
                           updated_at=now - timedelta(hours=age))

    entries = [entry("fact-new", MemoryType.FACT), entry("pinned-fact", MemoryType.FACT, pinned=True, age=9),
               entry("constraint-old", MemoryType.CONSTRAINT, age=5), entry("constraint-new", MemoryType.CONSTRAINT),
               entry("pref", MemoryType.PREFERENCE), entry("decision", MemoryType.DECISION),
               entry("retracted", MemoryType.CONSTRAINT, status=MemoryStatus.RETRACTED),
               entry("candidate", MemoryType.CONSTRAINT, status=MemoryStatus.CANDIDATE)]
    assert [e.id for e in select_resident(entries)] == [
        "pinned-fact", "constraint-new", "constraint-old", "pref", "decision", "fact-new"]
    many = [entry(f"m{i}", MemoryType.FACT, age=i) for i in range(30)]
    assert len(select_resident(many)) == RESIDENT_MEMORY_LIMIT == 12
    assert [e.id for e in select_resident(many, 3)] == ["m0", "m1", "m2"]


def test_fingerprint_ignores_case_spacing_and_punctuation_and_parse_tolerates_fences():
    assert content_fingerprint("Use  Python，please!") == content_fingerprint("use python please")
    assert content_fingerprint("a") != content_fingerprint("b")
    assert parse_decisions('说明\n```json\n[{"action": "add"}]\n```') == [{"action": "add"}]
    assert parse_decisions('{"action": "none"}') == [{"action": "none"}]
    with pytest.raises(ValueError):
        parse_decisions("没有 JSON")


# ---- D4 与提交 ----

def test_add_is_active_auto_inferred_and_protected_targets_become_candidates(tmp_path):
    async def body(env: MemEnv):
        ws = await env.workspace()
        session = await env.session(ws.id)
        seq = await env.say(session.id, "我们的发布窗口是每周三")
        user_entry = await env.memory.create(ws.id, "发布窗口是每周五")  # 用户创建：受保护
        agent_entry = await env.memory.create(ws.id, "评审必须双人通过", origin=MemoryOrigin.AGENT_REQUESTED)

        job = await claim(env, ws.id, session.id, seq)
        result = await env.memory.commit_extraction(job.id, [
            decision(ExtractionAction.ADD, "团队使用 Rust 编写核心", kind=MemoryType.DECISION),
            decision(ExtractionAction.UPDATE, "发布窗口是每周三", user_entry, version=user_entry.version),
            decision(ExtractionAction.DELETE, "评审不再需要双人通过", agent_entry, version=agent_entry.version),
        ])
        assert result.status is ExtractionCommitStatus.COMMITTED
        assert len(result.created) == 1 and len(result.candidates) == 2 and not result.updated and not result.retracted
        created = await env.memory.get(ws.id, result.created[0])
        assert (created.origin, created.certainty, created.status) == (
            MemoryOrigin.AUTO_EXTRACTION, MemoryCertainty.MODEL_INFERRED, MemoryStatus.ACTIVE)
        # 受保护目标不变；矛盾结果保存为候选并指向目标，候选不参与检索与常驻
        assert (await env.memory.get(ws.id, user_entry.id)).content == "发布窗口是每周五"
        assert (await env.memory.get(ws.id, agent_entry.id)).status is MemoryStatus.ACTIVE
        candidates = await env.memory.entries(ws.id, [MemoryStatus.CANDIDATE])
        assert {c.supersedes_id for c in candidates} == {user_entry.id, agent_entry.id}
        assert all(c.certainty is MemoryCertainty.MODEL_INFERRED for c in candidates)
        resident_ids = {e.id for e in await env.memory.resident(ws.id)}
        assert user_entry.id in resident_ids and not resident_ids & {c.id for c in candidates}
        hit_ids = {h.source_id for h in await env.retrieval.search(ws.id, "发布窗口")}
        assert user_entry.id in hit_ids and not hit_ids & {c.id for c in candidates}
        # 用户确认候选：转活动并标为用户确认，目标被替代
        pending = next(c for c in candidates if c.supersedes_id == user_entry.id)
        confirmed = await env.memory.confirm(ws.id, pending.id, pending.version)
        assert (confirmed.status, confirmed.certainty) == (MemoryStatus.ACTIVE, MemoryCertainty.USER_CONFIRMED)
        assert (await env.memory.get(ws.id, user_entry.id)).status is MemoryStatus.SUPERSEDED
        with pytest.raises(ConflictError):
            await env.memory.confirm(ws.id, pending.id, confirmed.version)  # 已不是候选

    scenario(tmp_path, body)


def test_unconfirmed_auto_entries_are_updated_and_deleted_directly(tmp_path):
    async def body(env: MemEnv):
        ws = await env.workspace()
        session = await env.session(ws.id)
        first = await claim(env, ws.id, session.id, await env.say(session.id, "使用 Python 3.8"))
        added = await env.memory.commit_extraction(first.id, [
            decision(ExtractionAction.ADD, "项目使用 Python 3.8"), decision(ExtractionAction.ADD, "部署在北京机房")])
        py, room = [await env.memory.get(ws.id, item) for item in added.created]
        second = await claim(env, ws.id, session.id, await env.say(session.id, "升级到 Python 3.12，机房撤销"))
        result = await env.memory.commit_extraction(second.id, [
            decision(ExtractionAction.UPDATE, "项目使用 Python 3.12", py, version=py.version),
            decision(ExtractionAction.DELETE, "", room, version=room.version)])
        assert result.updated == [py.id] and result.retracted == [room.id] and not result.candidates
        assert (await env.memory.get(ws.id, py.id)).content == "项目使用 Python 3.12"
        assert (await env.memory.get(ws.id, py.id)).version == py.version + 1
        assert (await env.memory.get(ws.id, room.id)).status is MemoryStatus.RETRACTED
        assert [h.source_id for h in await env.retrieval.search(ws.id, "Python")] == [py.id]  # 索引随更新
        assert await env.retrieval.search(ws.id, "北京机房") == []  # 删除撤出索引

    scenario(tmp_path, body)


def test_late_generation_is_rejected_and_commit_is_idempotent(tmp_path):
    async def body(env: MemEnv):
        ws = await env.workspace()
        session = await env.session(ws.id)
        old = await claim(env, ws.id, session.id, await env.say(session.id, "第一轮"))
        new = await claim(env, ws.id, session.id, await env.say(session.id, "第二轮"))
        assert (old.generation, new.generation) == (1, 2)
        late = await env.memory.commit_extraction(old.id, [decision(ExtractionAction.ADD, "迟到结果不应写入")])
        assert late.status is ExtractionCommitStatus.REJECTED and late.reason == "generation_mismatch"
        assert await env.memory.entries(ws.id) == []
        ok = await env.memory.commit_extraction(new.id, [decision(ExtractionAction.ADD, "最新结果可以写入")])
        assert ok.status is ExtractionCommitStatus.COMMITTED and len(ok.created) == 1
        again = await env.memory.commit_extraction(new.id, [decision(ExtractionAction.ADD, "重复提交不再写入")])
        assert again.status is ExtractionCommitStatus.COMMITTED and again.reason == "already_finished"
        assert len(await env.memory.entries(ws.id)) == 1
        async with env.read_factory() as uow:
            assert (await uow.memory.get_extraction(old.id)).commit_status is ExtractionCommitStatus.REJECTED

    scenario(tmp_path, body)


def test_user_edit_after_planning_is_never_overwritten(tmp_path):
    async def body(env: MemEnv):
        ws = await env.workspace()
        session = await env.session(ws.id)
        first = await claim(env, ws.id, session.id, await env.say(session.id, "预算是十万"))
        target = await env.memory.get(ws.id, (await env.memory.commit_extraction(
            first.id, [decision(ExtractionAction.ADD, "项目预算十万元")])).created[0])
        second = await claim(env, ws.id, session.id, await env.say(session.id, "预算改成二十万"))
        planned = decision(ExtractionAction.UPDATE, "项目预算二十万元", target, version=target.version)
        # 提交之前用户编辑了这条记忆：版本变化且已是用户确认
        edited = await env.memory.edit(ws.id, target.id, target.version, content="项目预算十五万元（用户确认）")
        result = await env.memory.commit_extraction(second.id, [planned])
        assert result.updated == [] and len(result.candidates) == 1
        assert (await env.memory.get(ws.id, target.id)).content == edited.content
        # 即使目标未被确认，判定之后版本变了也不直接覆盖
        third = await claim(env, ws.id, session.id, await env.say(session.id, "再改"))
        other = await env.memory.get(ws.id, (await env.memory.commit_extraction(
            third.id, [decision(ExtractionAction.ADD, "办公室在三楼")])).created[0])
        stale_plan = decision(ExtractionAction.UPDATE, "办公室在五楼", other, version=other.version - 1)
        fourth = await claim(env, ws.id, session.id, await env.say(session.id, "再再改"))
        result = await env.memory.commit_extraction(fourth.id, [stale_plan])
        assert result.updated == [] and len(result.candidates) == 1
        assert (await env.memory.get(ws.id, other.id)).content == "办公室在三楼"
        # 目标来自别的工作区的判定被忽略
        foreign_ws = await env.workspace("别处")
        foreign = await env.memory.create(foreign_ws.id, "别处的记忆内容")
        fifth = await claim(env, ws.id, session.id, await env.say(session.id, "越界"))
        result = await env.memory.commit_extraction(fifth.id, [decision(ExtractionAction.DELETE, "x", foreign)])
        assert result.skipped == 1 and (await env.memory.get(foreign_ws.id, foreign.id)).status is MemoryStatus.ACTIVE

    scenario(tmp_path, body)


def test_retract_suppresses_same_source_material_until_new_material_or_explicit_request(tmp_path):
    async def body(env: MemEnv):
        ws = await env.workspace()
        session = await env.session(ws.id)
        seq = await env.say(session.id, "客户 X 偏好电话沟通")
        first = await claim(env, ws.id, session.id, seq)
        entry = await env.memory.get(ws.id, (await env.memory.commit_extraction(
            first.id, [decision(ExtractionAction.ADD, "客户 X 偏好电话沟通")])).created[0])
        retracted = await env.memory.retract(ws.id, entry.id, entry.version)
        assert retracted.status is MemoryStatus.RETRACTED
        async with env.read_factory() as uow:
            assert await uow.memory.is_suppressed(ws.id, session.id, seq, content_fingerprint(entry.content))
        # 同一截止材料再次提炼（如重试）不重复生成同样内容；换个标点也一样
        retry = await claim(env, ws.id, session.id, seq)
        again = await env.memory.commit_extraction(retry.id, [decision(ExtractionAction.ADD, "客户X偏好电话沟通。")])
        assert again.created == [] and again.skipped == 1
        # 新的截止材料不受抑制
        later = await claim(env, ws.id, session.id, await env.say(session.id, "客户 X 还是偏好电话沟通"))
        regenerated = await env.memory.commit_extraction(later.id, [decision(ExtractionAction.ADD, "客户 X 偏好电话沟通")])
        assert len(regenerated.created) == 1
        # 撤销撤回：恢复为活动条目，并解除对应抑制
        undone = await env.memory.undo(ws.id, entry.id)
        assert undone.status is MemoryStatus.ACTIVE
        async with env.read_factory() as uow:
            assert not await uow.memory.is_suppressed(ws.id, session.id, seq, content_fingerprint(entry.content))
            assert [c.action.value for c in await uow.memory.list_changes(entry.id)] == ["create", "retract", "undo"]

    scenario(tmp_path, body)


def test_explicit_request_creates_active_entry_and_never_user_confirmed_via_agent(tmp_path):
    async def body(env: MemEnv):
        ws = await env.workspace()
        session = await env.session(ws.id)
        seq = await env.say(session.id, "记住：报告用 A4")
        by_agent = await env.memory.create(ws.id, "报告用 A4 纸", origin=MemoryOrigin.AGENT_REQUESTED,
                                           session_id=session.id)
        assert (by_agent.status, by_agent.certainty) == (MemoryStatus.ACTIVE, MemoryCertainty.MATERIAL_STATED)
        by_user = await env.memory.create(ws.id, "报告署名用全名")
        assert by_user.certainty is MemoryCertainty.USER_CONFIRMED and by_user.origin is MemoryOrigin.USER
        from app.application.errors.exceptions import BadRequestError
        with pytest.raises(BadRequestError):
            await env.memory.create(ws.id, "x", origin=MemoryOrigin.AUTO_EXTRACTION)
        sources = await env.memory.sources(ws.id, by_agent.id)
        assert [(s.session_id, s.event_seq_end, s.available) for s in sources] == [(session.id, seq, True)]
        # 自动提炼的同内容条目被明确要求升级，而不是重复创建
        auto = await claim(env, ws.id, session.id, await env.say(session.id, "月报周一发"))
        added = await env.memory.commit_extraction(auto.id, [decision(ExtractionAction.ADD, "月报周一发送")])
        upgraded = await env.memory.create(ws.id, "月报周一发送", origin=MemoryOrigin.AGENT_REQUESTED)
        assert upgraded.id == added.created[0] and upgraded.is_user_protected
        assert len(await env.memory.entries(ws.id)) == 3
        # 钉住、取消钉住与撤销
        pinned = await env.memory.set_pinned(ws.id, by_user.id, by_user.version, True)
        assert [e.id for e in await env.memory.resident(ws.id)][0] == pinned.id
        reverted = await env.memory.undo(ws.id, by_user.id, pinned.version)
        assert reverted.pinned is False
        with pytest.raises(ConflictError) as conflict:
            await env.memory.edit(ws.id, by_user.id, by_user.version, content="过期编辑")
        assert conflict.value.info.resource_version == reverted.version
        # 会话已删除的来源如实标为不可用
        async with env.uow_factory() as uow:
            await uow.session.delete_by_id(session.id)
        assert not (await env.memory.sources(ws.id, by_agent.id))[0].available

    scenario(tmp_path, body)


# ---- 任务：登记、提炼与摘要 ----

def test_enqueue_respects_participation_and_auto_memory_and_claims_generation(tmp_path):
    async def body(env: MemEnv):
        ws = await env.workspace()
        off = await env.workspace("关闭自动记忆", auto_memory_enabled=False)
        session, private = await env.session(ws.id), await env.session(ws.id, participate=False)
        quiet = await env.session(off.id)
        for item in (session, private, quiet):
            await env.say(item.id, "你好")
        async with env.uow_factory() as uow:
            jobs = await enqueue_post_run_jobs(uow, env.memory, session.id)
            assert sorted(job.kind.value for job in jobs) == ["memory_extraction", "session_summary"]
            assert await enqueue_post_run_jobs(uow, env.memory, private.id) == []  # 不参与记忆：两者都不登记
            only_summary = await enqueue_post_run_jobs(uow, env.memory, quiet.id)
            assert [job.kind for job in only_summary] == [OperationKind.SESSION_SUMMARY]
            extraction_job = next(job for job in jobs if job.kind is OperationKind.MEMORY_EXTRACTION)
            record = await uow.memory.get_extraction_by_operation(extraction_job.operation_id)
            assert record.generation == 1 and record.source_seq_end == 1 and record.commit_status.value == "pending"
            # 同一截止位置重复登记返回已有任务，不重复登记代次
            again = await enqueue_post_run_jobs(uow, env.memory, session.id)
            assert {job.operation_id for job in again} == {job.operation_id for job in jobs}
            assert await uow.memory.next_extraction_generation(session.id) == 2

    scenario(tmp_path, body)


class FakeExtractor:
    def __init__(self, facts, decide=None, fail=False):
        self.facts, self._decide, self.fail, self.seen = facts, decide, fail, None

    async def propose(self, material):
        self.seen = material
        if self.fail:
            raise RuntimeError("模型不可用")
        return self.facts

    async def decide(self, fact, similar):
        return self._decide(fact, similar)


def test_extraction_handler_commits_with_injected_model_and_fails_without_claiming(tmp_path):
    async def body(env: MemEnv):
        ws = await env.workspace()
        session = await env.session(ws.id)
        await env.say(session.id, "我们的主语言是 Go")
        existing = await env.memory.create(ws.id, "主语言是 Java", origin=MemoryOrigin.USER)
        async with env.uow_factory() as uow:
            jobs = await enqueue_post_run_jobs(uow, env.memory, session.id)
        job = next(item for item in jobs if item.kind is OperationKind.MEMORY_EXTRACTION)
        # 之后到达的消息不属于本次提炼的材料
        await env.say(session.id, "之后才说的话")

        def decide(fact, similar):
            assert [item["id"] for item in similar] == [existing.id]  # 同一工作区的相似条目
            return decision(ExtractionAction.UPDATE, fact.content, existing, version=similar[0]["version"])

        extractor = FakeExtractor([ProposedFact("主语言是 Go")], decide)

        async def factory():
            return extractor

        handler = memory_extraction_handler(env.uow_factory, env.retrieval, env.memory, factory)
        # 模型失败：任务以异常结束，没有任何条目写入，也不是已提交
        failing = memory_extraction_handler(env.uow_factory, env.retrieval, env.memory,
                                            lambda: _async(FakeExtractor([], fail=True)))
        with pytest.raises(RuntimeError):
            await failing(JobStub(job))
        assert [e.id for e in await env.memory.entries(ws.id)] == [existing.id]
        assert (await env.memory.extraction_for_operation(job.operation_id)).commit_status is ExtractionCommitStatus.PENDING

        result = await handler(JobStub(job))
        assert result["status"] == "committed" and result["candidates"] == 1 and result["updated"] == 0
        assert all(item["seq"] <= 1 for item in extractor.seen["user_updates"])
        assert (await env.memory.get(ws.id, existing.id)).content == "主语言是 Java"  # 用户条目不被覆盖
        assert (await handler(JobStub(job)))["reason"] == "already_finished"

        # 会话改为不参与后，任务跳过
        await env.memory.set_session_participation(session.id, False)
        async with env.uow_factory() as uow:
            await uow.session.update_participation(session.id, True)
            more = await enqueue_post_run_jobs(uow, env.memory, session.id)
            await uow.session.update_participation(session.id, False)
        later = next(item for item in more if item.kind is OperationKind.MEMORY_EXTRACTION)
        assert (await handler(JobStub(later)))["status"] == "skipped"

    scenario(tmp_path, body)


async def _async(value):
    return value


def test_clip_material_drops_messages_after_the_cutoff():
    material = {"first_user": "a", "user_updates": [{"seq": 2, "message": "m"}, {"seq": 9, "message": "n"}],
                "finals": [{"seq": 3, "message": "f"}, {"seq": 8, "message": "g"}], "source_seq": 9, "run_states": []}
    clipped = clip_material(material, 5)
    assert [x["seq"] for x in clipped["user_updates"]] == [2] and [x["seq"] for x in clipped["finals"]] == [3]
    assert clipped["source_seq"] == 5 and "run_states" not in clipped


def test_summary_handler_claims_first_writes_back_and_rejects_late_results(tmp_path):
    async def body(env: MemEnv):
        ws = await env.workspace()
        session = await env.session(ws.id)
        await env.say(session.id, "目标：整理季度预算")
        async with env.uow_factory() as uow:
            jobs = await enqueue_post_run_jobs(uow, env.memory, session.id)
        job = next(item for item in jobs if item.kind is OperationKind.SESSION_SUMMARY)

        async def config():
            return None

        calls = []

        async def generate(llm_config, material):
            calls.append(material)
            async with env.read_factory() as uow:  # 生成期间已先提交代次与截止序号
                claimed = await uow.summary.get(session.id)
            assert claimed.state is SummaryState.GENERATING and claimed.generation == 1 and claimed.source_seq == 1
            return {"text": "整理季度预算的对话", "model": "fake"}

        handler = session_summary_handler(env.uow_factory, env.retrieval, config, generate)
        result = await handler(JobStub(job))
        assert result == {"status": "ready", "generation": 1, "source_seq": 1}
        async with env.read_factory() as uow:
            record = await uow.summary.get(session.id)
        assert (record.state, record.body, record.model) == (SummaryState.READY, "整理季度预算的对话", "fake")
        assert [h.source_id for h in await env.retrieval.search(ws.id, "季度预算")] == [session.id]
        # 没有新材料：跳过，不重复调用模型
        assert (await handler(JobStub(job)))["reason"] == "up_to_date" and len(calls) == 1

        # 生成期间出现更新的代次：迟到结果丢弃，不覆盖
        await env.say(session.id, "补充：预算改为按月")

        async def contested(llm_config, material):
            async with env.uow_factory() as uow:
                current = await uow.summary.get(session.id)
                await uow.summary.save(current.model_copy(update={"generation": current.generation + 1, "body": "较新的摘要"}))
            return {"text": "迟到的摘要", "model": "fake"}

        late = session_summary_handler(env.uow_factory, env.retrieval, config, contested)
        assert (await late(JobStub(job)))["reason"] == "generation_mismatch"
        async with env.read_factory() as uow:
            assert (await uow.summary.get(session.id)).body == "较新的摘要"

        # 失败或空结果：保留此前摘要，只标记失败
        await env.say(session.id, "再补充一句")

        async def empty(llm_config, material):
            return {"text": "  ", "model": "fake"}

        with pytest.raises(SummaryUnavailable):
            await session_summary_handler(env.uow_factory, env.retrieval, config, empty)(JobStub(job))
        async with env.read_factory() as uow:
            kept = await uow.summary.get(session.id)
        assert kept.state is SummaryState.FAILED and kept.body == "较新的摘要"

    scenario(tmp_path, body)
