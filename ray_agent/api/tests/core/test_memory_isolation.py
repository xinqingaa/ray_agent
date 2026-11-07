"""工作区隔离：两个工作区与独立对话互相读不到对方的工作方式、记忆与检索结果；模型工具没有工作区参数。"""
import pytest

from app.application.errors.exceptions import BadRequestError, ConflictError, NotFoundError
from app.application.services.memory_jobs import enqueue_post_run_jobs
from app.application.services.workspace_memory_runtime import BoundWorkspaceMemory
from app.application.services.workspace_service import wipe_workspace_memory
from app.domain.models.retrieval import SearchSourceType
from app.domain.models.session_summary_record import SessionSummaryRecord
from app.domain.models.workspace_memory import MemoryStatus
from app.domain.services.tools.memory import InstructionProposalTool, KnowledgeSearchTool, MemoryTool
from tests.support.memory_env import MemEnv
from tests.support.sqlite_db import with_database


def scenario(tmp_path, body):
    async def run(uow_factory, read_factory, database):
        await body(MemEnv(uow_factory, read_factory))
    with_database(tmp_path, run)


def test_instruction_and_memory_are_invisible_across_workspaces_and_standalone(tmp_path):
    async def body(env: MemEnv):
        a, b = await env.workspace("A"), await env.workspace("B")
        await env.style.publish(a.id, "A 的做事方式：只写简体中文", None)
        await env.style.publish(b.id, "B 的做事方式：只写英文", None)
        _, record_a = await env.style.current(a.id)
        _, record_b = await env.style.current(b.id)
        assert record_a.body == "A 的做事方式：只写简体中文" and record_b.body == "B 的做事方式：只写英文"
        assert (await env.fresh(a.id)).instruction_version == 1

        mem_a = await env.memory.create(a.id, "项目使用蓝色主题")
        mem_b = await env.memory.create(b.id, "项目使用蓝色主题和红色强调")
        assert [e.id for e in await env.memory.entries(a.id)] == [mem_a.id]
        assert [e.id for e in await env.memory.entries(b.id)] == [mem_b.id]
        # 别的工作区的条目对调用方等同不存在：读取、修改、撤回都找不到
        for call in (lambda: env.memory.get(b.id, mem_a.id),
                     lambda: env.memory.edit(b.id, mem_a.id, None, content="篡改"),
                     lambda: env.memory.retract(b.id, mem_a.id),
                     lambda: env.memory.sources(b.id, mem_a.id)):
            with pytest.raises(NotFoundError):
                await call()
        assert (await env.memory.get(a.id, mem_a.id)).status is MemoryStatus.ACTIVE

        # 同一关键词在两个工作区都有，检索只返回本工作区的条目
        hits_a = await env.retrieval.search(a.id, "蓝色主题")
        hits_b = await env.retrieval.search(b.id, "蓝色主题")
        assert [h.source_id for h in hits_a] == [mem_a.id]
        assert [h.source_id for h in hits_b] == [mem_b.id]
        assert await env.retrieval.search(a.id, "红色强调") == []  # 只有 B 有

        # 背景装配只带本工作区的内容
        sa = await env.session(a.id)
        assembled = await env.assembly.assemble(sa, "run-a", "蓝色主题是什么")
        assert "A 的做事方式" in assembled.project_prompt and "B 的做事方式" not in assembled.project_prompt
        assert mem_a.id in assembled.project_prompt and mem_b.id not in assembled.project_prompt
        assert "红色强调" not in assembled.project_prompt
        # 清单只能按运行读取，且记录了本运行的工作区
        manifest = await env.assembly.manifest("run-a")
        assert manifest.workspace_id == a.id and manifest.instruction_version == 1

        # 独立对话：没有背景、不能设置参与记忆、不登记摘要与提炼任务
        standalone = await env.session(None)
        empty = await env.assembly.assemble(standalone, "run-s", "蓝色主题")
        assert empty.project_prompt == "" and await env.assembly.manifest("run-s") is None
        with pytest.raises(BadRequestError):
            await env.memory.set_session_participation(standalone.id, True)
        async with env.uow_factory() as uow:
            assert await enqueue_post_run_jobs(uow, env.memory, standalone.id) == []

    scenario(tmp_path, body)


def test_tool_ports_are_bound_to_the_session_workspace(tmp_path):
    async def body(env: MemEnv):
        a, b = await env.workspace("A"), await env.workspace("B")
        sa = await env.session(a.id)
        mem_b = await env.memory.create(b.id, "B 的私有约定：禁用缓存")
        port = BoundWorkspaceMemory(a.id, sa.id, "run-1", env.memory, env.retrieval, env.style)

        remembered = await port.remember("A 的约定：周五不发布", "constraint")
        assert remembered["certainty"] == "material_stated" and remembered["origin"] == "agent_requested"
        assert [item["id"] for item in await port.list_memories("active", 10)] == [remembered["id"]]
        assert await port.search("禁用缓存", None) == []  # B 的内容检索不到
        with pytest.raises(NotFoundError):
            await port.forget(mem_b.id)  # 即使模型猜到了 B 的条目 id
        assert (await env.memory.get(b.id, mem_b.id)).status is MemoryStatus.ACTIVE
        forgotten = await port.forget(remembered["id"])
        assert forgotten["status"] == "retracted"
        assert await port.search("周五不发布", None) == []  # 撤回后撤出检索

        # 提议只登记待确认的草案，不改变当前工作方式
        proposal = await port.propose_working_style("新的工作方式", "用户要求")
        assert proposal["status"] == "pending"
        _, record = await env.style.current(a.id)
        assert record is None
        with pytest.raises(BadRequestError):
            await port.search("x", ["document_chunk"])  # 文件内容检索 P5 不提供

    scenario(tmp_path, body)


def test_model_tools_have_no_workspace_parameter():
    for toolkit in (MemoryTool(None), KnowledgeSearchTool(None), InstructionProposalTool(None)):
        for schema in toolkit.get_tools():
            properties = schema["function"]["parameters"]["properties"]
            assert not any("workspace" in key for key in properties), schema["function"]["name"]


def test_session_summary_search_is_scoped_and_leaves_with_non_participating_session(tmp_path):
    async def body(env: MemEnv):
        a, b = await env.workspace("A"), await env.workspace("B")
        sa, sb = await env.session(a.id), await env.session(b.id)
        for session, workspace, text in ((sa, a, "讨论了季度预算评审"), (sb, b, "讨论了季度预算评审和招聘")):
            async with env.uow_factory() as uow:
                record = SessionSummaryRecord(session_id=session.id, workspace_id=workspace.id, body=text,
                                              source_seq=3)
                await uow.summary.save(record)
                await env.retrieval.index_summary(uow, record)
        hits = await env.retrieval.search(a.id, "季度预算", [SearchSourceType.SESSION_SUMMARY])
        assert [h.source_id for h in hits] == [sa.id]
        # 设为不参与记忆：摘要撤出检索
        await env.memory.set_session_participation(sa.id, False)
        assert await env.retrieval.search(a.id, "季度预算") == []
        assert [h.source_id for h in await env.retrieval.search(b.id, "季度预算")] == [sb.id]

    scenario(tmp_path, body)


def test_workspace_wipe_removes_only_that_workspace(tmp_path):
    async def body(env: MemEnv):
        a, b = await env.workspace("A"), await env.workspace("B")
        await env.style.publish(a.id, "A 方式", None)
        await env.style.publish(b.id, "B 方式", None)
        await env.memory.create(a.id, "A 记忆内容独有")
        kept = await env.memory.create(b.id, "B 记忆内容独有")
        sa = await env.session(a.id)
        await env.assembly.assemble(sa, "run-wipe", "A 记忆内容独有")
        async with env.uow_factory() as uow:
            await wipe_workspace_memory(uow, a.id)
        async with env.read_factory() as uow:
            assert await uow.memory.list(a.id) == [] and await uow.instruction.latest(a.id) is None
            assert await uow.run_context.get("run-wipe") is None
        assert await env.retrieval.search(a.id, "记忆内容独有") == []
        assert [h.source_id for h in await env.retrieval.search(b.id, "记忆内容独有")] == [kept.id]
        _, record_b = await env.style.current(b.id)
        assert record_b.body == "B 方式"

    scenario(tmp_path, body)


def test_working_style_versions_templates_and_conflicts(tmp_path):
    async def body(env: MemEnv):
        a, b = await env.workspace("A", local_execution_enabled=True), await env.workspace("B")
        version = (await env.fresh(a.id)).version
        first = await env.style.publish(a.id, "第一版", version)
        assert first.version == 1
        with pytest.raises(ConflictError) as stale:
            await env.style.publish(a.id, "过期写入", version)  # 工作区 version 已因发布而递增
        assert stale.value.info.resource_version == (await env.fresh(a.id)).version
        with pytest.raises(BadRequestError):
            await env.style.publish(a.id, "x" * 4001, None)

        # 提议：确认才发布；基于旧版本的提议在工作方式变化后作废
        stale_proposal = await env.style.propose(a.id, "草案 A", "理由")
        await env.style.publish(a.id, "第二版", None)
        with pytest.raises(ConflictError):
            await env.style.accept(a.id, stale_proposal.id)
        fresh_proposal = await env.style.propose(a.id, "草案 B")
        accepted = await env.style.accept(a.id, fresh_proposal.id)
        assert accepted.source.value == "confirmed_proposal" and accepted.version == 3
        rejected = await env.style.propose(a.id, "草案 C")
        assert (await env.style.reject(a.id, rejected.id)).status.value == "rejected"
        with pytest.raises(NotFoundError):
            await env.style.accept(b.id, rejected.id)  # 别的工作区的提议

        # 模板只带正文与可选的工具建议，不带记忆；应用模板发布新版本，不自动启用开关
        await env.memory.create(a.id, "不应进入模板的记忆")
        template = await env.style.save_template(a.id, "我的模板", include_tool_suggestions=True)
        assert template.body == "草案 B" and template.tool_suggestions == {"local_execution_enabled": True}
        record, _ = await env.style.apply_template(b.id, template.id)
        assert record.source.value == "template" and record.body == "草案 B"
        assert "local_execution_enabled" not in (await env.fresh(b.id)).settings
        assert await env.memory.entries(b.id) == []
        await env.style.delete_template(template.id)
        assert await env.style.templates() == []

    scenario(tmp_path, body)
