"""运行与工作区记忆的衔接：背景段进入系统提示并随运行冻结、记忆工具经真实循环写入、运行完成时同事务登记任务、
续接前移除已撤回的内容。真实 SQLite 业务库，脚本化模型。"""
from app.application.services.workspace_memory_runtime import BoundWorkspaceMemory
from app.domain.models.operation import OperationKind, OperationStatus
from app.domain.models.run import RunStatus
from app.domain.models.workspace_memory import MemoryOrigin, MemoryStatus
from app.domain.services.tools.memory import workspace_toolkits
from tests.support.loop_harness import input_task, make_loop, make_runner, start_run
from tests.support.memory_env import MemEnv
from tests.support.scripted_llm import text, tool_call
from tests.support.sqlite_db import with_database


def scenario(tmp_path, body):
    async def run(uow_factory, read_factory, database):
        await body(MemEnv(uow_factory, read_factory), uow_factory, read_factory)
    with_database(tmp_path, run, timeout=60)


def test_workspace_run_gets_background_tools_and_post_run_jobs_then_frozen_refresh(tmp_path):
    async def body(env: MemEnv, uow_factory, read_factory):
        ws = await env.workspace("运行衔接")
        other = await env.workspace("别的工作区")
        await env.style.publish(ws.id, "回答前先复述需求", None)
        resident = await env.memory.create(ws.id, "预算上限是十万元", "constraint")
        await env.memory.create(other.id, "别处的预算上限是一百万元", "constraint")
        session = await env.session(ws.id)
        port = BoundWorkspaceMemory(ws.id, session.id, "run-x", env.memory, env.retrieval, env.style)

        h = make_loop([tool_call("memory_remember", {"content": "报告使用 A4 纸", "memory_type": "preference"}, id="m1"),
                       tool_call("knowledge_search", {"query": "预算上限"}, id="k1"),
                       text("已记住")],
                      session=session, uow_factory=uow_factory, extra_tools=workspace_toolkits(port))
        started = await start_run(h, input_task(), "预算上限是多少？顺便记住报告用 A4 纸")
        assembled = await env.assembly.assemble(session, started.id)
        assert "回答前先复述需求" in assembled.project_prompt and resident.id in assembled.project_prompt
        assert "一百万" not in assembled.project_prompt
        h.loop.project_prompt = assembled.project_prompt
        runner = make_runner(h, run=started)
        runner._completion = env.runtime
        await runner.invoke(input_task())

        async with read_factory() as uow:
            run = await uow.run.get(started.id)
            memories = await uow.memory.list(ws.id)
            summary_job = await uow.job.latest(OperationKind.SESSION_SUMMARY)
            extraction_job = await uow.job.latest(OperationKind.MEMORY_EXTRACTION)
            foreign = await uow.memory.list(other.id)
        assert run.status is RunStatus.COMPLETED, run.reason
        # 背景段进入实际发送的系统提示并被快照冻结；清单可按运行读回
        assert "<working_style" in run.config_snapshot["system_prompt"]
        assert run.config_snapshot["project_prompt"] == assembled.project_prompt
        manifest = await env.assembly.manifest(started.id)
        assert manifest.instruction_version == 1 and [m.memory_id for m in manifest.resident_memories] == [resident.id]
        # 记忆工具写入本会话的工作区：用户要求下的 Agent 写入，未标为用户确认
        written = next(m for m in memories if m.content == "报告使用 A4 纸")
        assert written.origin is MemoryOrigin.AGENT_REQUESTED and written.certainty.value == "material_stated"
        assert len(foreign) == 1  # 别的工作区没有被写入
        # 运行正常结束的同一事务登记了摘要与提炼任务
        assert summary_job.status is OperationStatus.QUEUED and summary_job.scope.workspace_id == ws.id
        assert extraction_job.payload["session_id"] == session.id and extraction_job.payload["source_seq_end"] >= 1
        async with read_factory() as uow:
            record = await uow.memory.get_extraction_by_operation(extraction_job.operation_id)
        assert record is not None and record.generation == 1

        # 撤回常驻记忆后，续接前冻结的背景移除它，清单记录修订，快照同步更新
        await env.memory.retract(ws.id, resident.id)
        resumed = make_runner(h, run=run)
        resumed._context_refresh = env.runtime.refresh
        resumed._next_turn = run.turns + 1
        await resumed._prepare_run()
        async with read_factory() as uow:
            revised = await uow.run.get(started.id)
        assert resident.id not in revised.config_snapshot["system_prompt"]
        assert resident.id not in revised.config_snapshot["project_prompt"]
        assert "回答前先复述需求" in revised.config_snapshot["system_prompt"]
        assert revised.config_snapshot["context_revisions"][0]["reason"] == "unavailable_after_freeze"
        manifest = await env.assembly.manifest(started.id)
        assert manifest.resident_memories == [] and manifest.omissions[-1].kind == "revision"
        assert (await env.memory.get(ws.id, resident.id)).status is MemoryStatus.RETRACTED

    scenario(tmp_path, body)


def test_failed_run_does_not_enqueue_memory_jobs(tmp_path):
    async def body(env: MemEnv, uow_factory, read_factory):
        ws = await env.workspace("失败运行")
        session = await env.session(ws.id)
        h = make_loop([RuntimeError("模型不可用")] * 6, session=session, uow_factory=uow_factory, max_retries=2)
        started = await start_run(h, input_task(), "你好")
        runner = make_runner(h, run=started)
        runner._completion = env.runtime
        await runner.invoke(input_task())
        async with read_factory() as uow:
            run = await uow.run.get(started.id)
            assert run.status is RunStatus.FAILED
            assert await uow.job.latest(OperationKind.SESSION_SUMMARY) is None
            assert await uow.job.latest(OperationKind.MEMORY_EXTRACTION) is None

    scenario(tmp_path, body)
