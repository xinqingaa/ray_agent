"""基础能力底座、6 项内置场景预设、跨轮粘性、标准库核验脚本与搜索语言头测试。"""
import asyncio
import json
import subprocess
import sys
from pathlib import Path
from unittest.mock import AsyncMock

import httpx
import pytest
from docx import Document
from fastapi import FastAPI
from openpyxl import Workbook
from pptx import Presentation

from app.application.services.agent_service import AgentService
from app.application.services.app_config_service import AppConfigService
from app.application.services.session_service import SessionService
from app.application.services.skill_runtime import SkillRuntime
from app.application.services.skill_service import SkillService
from app.builtin_skills.registry import BUILTIN_SKILLS
from app.domain.models.app_config import A2AConfig, AgentConfig, AppConfig, LLMConfig, MCPConfig, SkillConfig
from app.domain.models.event import ErrorEvent
from app.domain.models.message import Message, SkillSelection
from app.domain.models.run import RunMode, RunStatus
from app.domain.models.workspace import Workspace
from app.domain.services.context.compactor import Compactor
from app.domain.services.run_ledger import RunLedger
from app.domain.services.skill_context import catalog_message
from app.domain.services.tools.skill import SkillTool
from app.infrastructure.external.search import bing_search as bing_module
from app.infrastructure.external.search.bing_search import BingSearchEngine
from app.infrastructure.external.skills.github import GitHubSkills
from app.infrastructure.external.skills.storage import SkillStorage
from app.infrastructure.repositories.db_skill_repository import DBSkillRepository
from app.interfaces.endpoints.session_routes import router as session_router
from app.interfaces.endpoints.skill_routes import router as skill_router
from app.interfaces.errors.exception_handlers import register_exception_handlers
from app.interfaces.service_dependencies import get_app_config_service, get_session_service, get_skill_service
from core.config import Settings
from tests.core.test_skills import install, source
from tests.support.loop_harness import MemoryNotifier, make_loop
from tests.support.scripted_llm import ScriptedLLM, text
from tests.support.sqlite_db import with_database


def _build_skill_service(database, tmp_path, *, settings: Settings | None = None, config_loader=None):
    cfg = settings or Settings(_env_file=None)
    return SkillService(
        DBSkillRepository(database),
        SkillStorage(tmp_path / "skills", cfg),
        GitHubSkills(cfg),
        cfg,
        config_loader=config_loader or (lambda: SkillConfig(discover_user=False, discover_workspace=False)),
    )


def test_builtin_registry_initializes_10_skills_with_denoising_and_presets_api(tmp_path):
    async def scenario(uow_factory, read_factory, database):
        s = _build_skill_service(database, tmp_path)
        await s.initialize()
        items = await s.list()
        by_id = {item["id"]: item for item in items}

        assert set(BUILTIN_SKILLS) <= set(by_id)
        assert len([item for item in items if item.get("builtin")]) == 10
        for retired in ("elicitation-communication", "structured-thinking"):
            assert retired not in by_id

        # 基础底座进入默认自由对话目录；面试 / 情绪预设仅从预设或显式选择进入
        assert by_id["preset-interview"]["included"] is False
        assert by_id["preset-emotional-support"]["included"] is False
        for included_id in ("find-skills", "research-grounding",
                            "presentation-design", "verification-critique",
                            "preset-ppt", "preset-excel", "preset-web-tool", "preset-doc-brief"):
            assert by_id[included_id]["included"] is True

        # 包含 references/ 与 scripts/ 资源
        expected_resources = {
            "research-grounding": {"SKILL.md", "references/deepsearch-playbook.md"},
            "presentation-design": {"SKILL.md", "references/visual-checklist.md"},
            "verification-critique": {"SKILL.md", "scripts/verify_office.py"},
            "preset-emotional-support": {"SKILL.md"},
            "preset-interview": {"SKILL.md", "references/interview-playbook.md"},
            "preset-doc-brief": {"SKILL.md", "references/brief-templates.md"},
            "preset-ppt": {"SKILL.md", "references/slide-patterns.md"},
            "preset-excel": {"SKILL.md", "references/excel-engineering.md"},
            "preset-web-tool": {"SKILL.md", "references/web-tool-patterns.md"},
        }
        details_by_id = {}
        for skill_id in BUILTIN_SKILLS:
            detail = await s.detail(skill_id)
            details_by_id[skill_id] = detail
            assert len(detail["description"]) <= s.settings.skill_catalog_description_chars
            if skill_id in expected_resources:
                assert {f["path"] for f in detail["files"]} == expected_resources[skill_id]
            for file_meta in detail["files"]:
                if file_meta["path"].startswith("references/"):
                    raw = await s.file(skill_id, detail["version"], file_meta["path"])
                    assert len(raw.decode("utf-8")) <= s.settings.skill_resource_chars

        # 情绪疏导采用 Option A 极简版本：无人工句数上限、保留 110/120/12356 危机求助边界、不强绑工具或基础依赖
        emo_text = details_by_id["preset-emotional-support"]["text"]
        assert "3–6 句" not in emo_text and "12356" in emo_text and "110" in emo_text and "120" in emo_text
        assert BUILTIN_SKILLS["preset-emotional-support"].preset.depends_on == []
        assert BUILTIN_SKILLS["preset-emotional-support"].preset.execution_profile == "dialogue"

        # 任一预设及 depends_on 组合预加载不得超出活动 Skill 总预算
        for spec in BUILTIN_SKILLS.values():
            if not spec.preset:
                continue
            preload = [spec.id, *spec.preset.depends_on]
            assert sum(details_by_id[sid]["context_chars"] for sid in preload) < s.settings.skill_active_chars

        # 目录总体积远小于 24,000 上限
        included_builtins = [item for item in items if item.get("builtin") and item.get("included")]
        catalog_text = catalog_message("", included_builtins, s.settings.skill_catalog_description_chars)["content"]
        assert len(catalog_text) < s.settings.skill_catalog_chars

        # HTTP 接口返回 6 项预设元数据及 execution_profile
        app = FastAPI()
        app.include_router(skill_router, prefix="/api")
        app.dependency_overrides[get_skill_service] = lambda: s
        register_exception_handlers(app)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.get("/api/skills/presets")
            assert resp.status_code == 200
            preset_items = resp.json()["data"]["items"]
            assert [p["id"] for p in preset_items] == [
                "preset-ppt", "preset-excel", "preset-web-tool",
                "preset-doc-brief", "preset-interview", "preset-emotional-support",
            ]
            by_preset = {p["id"]: p for p in preset_items}
            assert by_preset["preset-emotional-support"]["default_participate_in_memory"] is False
            assert by_preset["preset-emotional-support"]["execution_profile"] == "dialogue"
            assert by_preset["preset-interview"]["execution_profile"] == "interactive"
            assert by_preset["preset-ppt"]["execution_profile"] == "workspace_task"

    with_database(tmp_path, scenario)


def test_session_preset_lifecycle_memory_exclusion_and_disabled_state(tmp_path):
    async def scenario(uow_factory, read_factory, database):
        disabled: set[str] = set()
        s = _build_skill_service(
            database, tmp_path,
            config_loader=lambda: SkillConfig(
                discover_user=False, discover_workspace=False, disabled_skills=sorted(disabled)
            ),
        )
        await s.initialize()

        async with uow_factory() as uow:
            await uow.workspace.add(Workspace(id="ws-1", name="工作区"))

        sessions = SessionService(uow_factory, read_uow_factory=read_factory, skills=s)

        class _StubConfigRepo:
            async def load(self):
                return AppConfig(llm_config=LLMConfig(), agent_config=AgentConfig(),
                                 mcp_config=MCPConfig(), a2a_config=A2AConfig())

        app = FastAPI()
        app.include_router(session_router, prefix="/api")
        app.include_router(skill_router, prefix="/api")
        app.dependency_overrides[get_session_service] = lambda: sessions
        app.dependency_overrides[get_skill_service] = lambda: s
        app.dependency_overrides[get_app_config_service] = lambda: AppConfigService(_StubConfigRepo())
        register_exception_handlers(app)

        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            # 1. 工作区下选用情绪疏导，默认 participate_in_memory=False
            r1 = await client.post("/api/sessions", json={"workspace_id": "ws-1", "active_preset_id": "preset-emotional-support"})
            assert r1.status_code == 200
            sid_emo = r1.json()["data"]["session_id"]
            emo_domain = await sessions.get_session(sid_emo)
            assert emo_domain is not None and emo_domain.participate_in_memory is False
            assert emo_domain.active_preset_id == "preset-emotional-support"
            emo_http = (await client.get(f"/api/sessions/{sid_emo}")).json()["data"]
            assert emo_http["participate_in_memory"] is False

            # 2. 工作区下选用 PPT 预设，默认 participate_in_memory=True
            r2 = await client.post("/api/sessions", json={"workspace_id": "ws-1", "active_preset_id": "preset-ppt"})
            sid_ppt = r2.json()["data"]["session_id"]
            ppt_domain = await sessions.get_session(sid_ppt)
            assert ppt_domain is not None and ppt_domain.participate_in_memory is True
            ppt_http = (await client.get(f"/api/sessions/{sid_ppt}")).json()["data"]
            assert ppt_http["participate_in_memory"] is True

            # 非内置 preset_id 拒绝
            r_bad = await client.post("/api/sessions", json={"active_preset_id": "research-grounding"})
            assert r_bad.status_code == 400

            # 3. 停用 preset-ppt 后，GET /sessions/{id} 反映失效状态
            disabled.add("preset-ppt")
            detail_disabled = (await client.get(f"/api/sessions/{sid_ppt}")).json()["data"]
            assert detail_disabled["active_preset_id"] == "preset-ppt"
            assert detail_disabled["active_preset"]["active"] is False
            assert detail_disabled["active_preset"]["inactive_reason"]

            # 4. 退出预设回自由模式
            cleared = await client.put(f"/api/sessions/{sid_ppt}/preset", json={"active_preset_id": None})
            assert cleared.status_code == 200 and cleared.json()["data"]["active_preset_id"] is None
            detail_cleared = (await client.get(f"/api/sessions/{sid_ppt}")).json()["data"]
            assert detail_cleared["active_preset_id"] is None and detail_cleared["active_preset"] is None

    with_database(tmp_path, scenario)


def test_preset_sticky_preload_coexists_with_slash_skill_budget_plan_and_compaction(tmp_path):
    async def scenario(uow_factory, read_factory, database):
        disabled: set[str] = set()
        s = _build_skill_service(
            database, tmp_path,
            config_loader=lambda: SkillConfig(
                discover_user=False, discover_workspace=False, disabled_skills=sorted(disabled)
            ),
        )
        await s.initialize()
        user_skill = await install(s, {"SKILL.md": source("extra-pack", "用户额外扩展规则").decode()})

        sessions = SessionService(uow_factory, read_uow_factory=read_factory, skills=s)
        session = await sessions.create_session(active_preset_id="preset-interview")
        ledger = RunLedger(uow_factory, MemoryNotifier())

        # 第 1 轮运行：自动冻结并预加载 preset-interview + research-grounding，同时并存显式 /extra-pack
        async def accept_run1(uow):
            await s.accept(uow, session.id, SkillSelection(id=user_skill["id"], version=user_skill["version"]))

        run1 = await ledger.start(session.id, apply=accept_run1)
        async with read_factory() as uow:
            stored_run1 = await uow.run.get(run1.id)
        assert stored_run1 is not None
        assert stored_run1.config_snapshot["active_preset_id"] == "preset-interview"
        assert stored_run1.config_snapshot["preset_preload_ids"] == [
            "preset-interview", "research-grounding"
        ]

        rt1 = SkillRuntime(s, run1.id, session_id=session.id, preset_preload_ids=stored_run1.config_snapshot["preset_preload_ids"])
        await rt1.initialize(frozen=True)
        h1 = make_loop([text("第1轮完成")], extra_tools=[SkillTool(rt1)])
        h1.loop.skill_runtime, h1.loop.run_id = rt1, run1.id
        _ = [e async for e in h1.loop.invoke(Message(
            message="准备面试",
            skill=SkillSelection(id=user_skill["id"], version=user_skill["version"]),
        ))]
        active_names_1 = {
            m["_ray_skill"]["name"] for m in h1.llm.requests[0].messages
            if m.get("_ray_skill", {}).get("kind") == "body"
        }
        assert active_names_1 == {
            "preset-interview", "research-grounding", "extra-pack"
        }

        # 压缩保留所有已激活的预设及依赖正文
        compactor = Compactor(ScriptedLLM([text("历史摘要")], context_window=32000, max_tokens=4096), AgentConfig())
        blocks = await rt1.context()
        compact_res = await compactor.compact(
            [{"role": "system", "content": "sys"}, {"role": "user", "content": "准备面试"}, *blocks,
             {"role": "assistant", "content": "a"}, {"role": "assistant", "content": "b"}, {"role": "assistant", "content": "c"}],
            [], compactor.fresh_budget().estimate(blocks, []), "manual", AsyncMock(return_value=[]), False,
        )
        assert compact_res.status.value == "compacted"
        preserved_names = {
            m["_ray_skill"]["name"] for m in compact_res.messages
            if m.get("_ray_skill", {}).get("kind") == "body"
        }
        assert preserved_names == active_names_1
        await ledger.transition(session.id, run1.id, RunStatus.COMPLETED)

        # 第 2 轮运行（未选 /skill）：跨轮仍保持预加载，且在 PlanMode 下照常加载
        async def accept_run2(uow):
            await s.accept(uow, session.id, None)

        run2 = await ledger.start(session.id, mode=RunMode.PLAN, apply=accept_run2)
        async with read_factory() as uow:
            stored_run2 = await uow.run.get(run2.id)
        rt2 = SkillRuntime(s, run2.id, session_id=session.id, preset_preload_ids=stored_run2.config_snapshot["preset_preload_ids"])
        await rt2.initialize(frozen=True)
        h2 = make_loop([text("计划完成")], extra_tools=[SkillTool(rt2)])
        h2.loop.skill_runtime, h2.loop.run_id, h2.loop.mode = rt2, run2.id, RunMode.PLAN
        _ = [e async for e in h2.loop.invoke(Message(message="继续下一题"))]
        active_names_2 = {
            m["_ray_skill"]["name"] for m in h2.llm.requests[0].messages
            if m.get("_ray_skill", {}).get("kind") == "body"
        }
        assert active_names_2 == {
            "preset-interview", "research-grounding"
        }
        await ledger.transition(session.id, run2.id, RunStatus.COMPLETED)

        # 活动正文预算超限时必须明确报错失败，不静默降级
        s.settings.skill_active_chars = 100
        run_budget = await ledger.start(session.id, apply=accept_run2)
        async with read_factory() as uow:
            stored_budget = await uow.run.get(run_budget.id)
        rt_budget = SkillRuntime(s, run_budget.id, session_id=session.id,
                                 preset_preload_ids=stored_budget.config_snapshot["preset_preload_ids"])
        await rt_budget.initialize(frozen=True)
        h_budget = make_loop([], extra_tools=[SkillTool(rt_budget)])
        h_budget.loop.skill_runtime, h_budget.loop.run_id = rt_budget, run_budget.id
        events_budget = [e async for e in h_budget.loop.invoke(Message(message="超预算"))]
        assert any(isinstance(e, ErrorEvent) for e in events_budget) and not h_budget.llm.requests
        s.settings.skill_active_chars = 100000
        await ledger.transition(session.id, run_budget.id, RunStatus.FAILED)

        # 停用 preset-interview 后，新运行不再预加载
        disabled.add("preset-interview")
        run3 = await ledger.start(session.id, apply=accept_run2)
        async with read_factory() as uow:
            stored_run3 = await uow.run.get(run3.id)
        assert stored_run3.config_snapshot["preset_preload_ids"] == []
        rt3 = SkillRuntime(s, run3.id, session_id=session.id, preset_preload_ids=[])
        await rt3.initialize(frozen=True)
        h3 = make_loop([text("自由回答")], extra_tools=[SkillTool(rt3)])
        h3.loop.skill_runtime, h3.loop.run_id = rt3, run3.id
        _ = [e async for e in h3.loop.invoke(Message(message="你好"))]
        assert not any(m.get("_ray_skill", {}).get("kind") == "body" for m in h3.llm.requests[0].messages)

    with_database(tmp_path, scenario)


def test_verify_office_script_runs_with_stdlib_python(tmp_path):
    script = Path(__file__).resolve().parents[2] / "app/builtin_skills/verification-critique/scripts/verify_office.py"
    bundled = Path(__file__).resolve().parents[2] / "build/tool-runtimes/python/bin/python3"
    python_exe = str(bundled) if bundled.is_file() else sys.executable
    flags = ["-I"] if bundled.is_file() else []

    # 1. XLSX（含未缓存公式）
    xlsx_path = tmp_path / "sum.xlsx"
    wb = Workbook()
    ws = wb.active
    ws.append(["项目", "金额"])
    ws.append(["A", 10])
    ws.append(["合计", "=SUM(B2:B2)"])
    wb.save(xlsx_path)

    # 2. PPTX
    pptx_path = tmp_path / "slides.pptx"
    prs = Presentation()
    slide = prs.slides.add_slide(prs.slide_layouts[1])
    slide.shapes.title.text = "汇报标题"
    slide.placeholders[1].text = "核心要点"
    prs.save(pptx_path)

    # 3. DOCX
    docx_path = tmp_path / "doc.docx"
    doc = Document()
    doc.add_paragraph("正式报告正文。")
    doc.save(docx_path)

    # 4. HTML（正常与缺失资源）
    html_ok = tmp_path / "ok.html"
    html_ok.write_text("<!doctype html><html><meta charset='utf-8'><body><h1>看板</h1></body></html>", encoding="utf-8")
    html_bad = tmp_path / "bad.html"
    html_bad.write_text("<html><body><script src='./missing.js'></script><p>hi</p></body></html>", encoding="utf-8")

    def run_check(target: Path):
        proc = subprocess.run([python_exe, *flags, str(script), str(target)], capture_output=True, text=True)
        return proc.returncode, json.loads(proc.stdout)

    code_x, rep_x = run_check(xlsx_path)
    assert code_x == 0 and rep_x["passed"] is True
    assert rep_x["metrics"]["uncached_formulas"] == 1 and rep_x["warnings"]

    code_p, rep_p = run_check(pptx_path)
    assert code_p == 0 and rep_p["passed"] is True and rep_p["metrics"]["slides"] == 1

    code_d, rep_d = run_check(docx_path)
    assert code_d == 0 and rep_d["passed"] is True and rep_d["metrics"]["total_chars"] > 0

    code_h1, rep_h1 = run_check(html_ok)
    assert code_h1 == 0 and rep_h1["passed"] is True

    code_h2, rep_h2 = run_check(html_bad)
    assert code_h2 == 1 and rep_h2["passed"] is False and rep_h2["issues"]


def test_bing_search_uses_chinese_accept_language_for_cjk_queries(monkeypatch):
    seen_headers: list[dict[str, str]] = []
    original_client = bing_module.httpx.AsyncClient

    def handler(request: httpx.Request) -> httpx.Response:
        seen_headers.append(dict(request.headers))
        return httpx.Response(200, text="<html><body></body></html>")

    monkeypatch.setattr(
        bing_module.httpx,
        "AsyncClient",
        lambda **kwargs: original_client(transport=httpx.MockTransport(handler), **kwargs),
    )

    async def check():
        engine = BingSearchEngine()
        await engine.invoke("北京 天气")
        await engine.invoke("python dataclasses")

    asyncio.run(check())
    assert len(seen_headers) == 2
    assert seen_headers[0]["accept-language"].startswith("zh-CN")
    assert seen_headers[1]["accept-language"].startswith("en-US")


def test_builtin_skills_untied_from_artificial_caps():
    from pathlib import Path

    root = Path(__file__).resolve().parents[2] / "app" / "builtin_skills"
    web_text = (root / "preset-web-tool" / "SKILL.md").read_text(encoding="utf-8")
    emo_text = (root / "preset-emotional-support" / "SKILL.md").read_text(encoding="utf-8")
    doc_brief_text = (root / "preset-doc-brief" / "SKILL.md").read_text(encoding="utf-8")
    deepsearch_text = (root / "research-grounding" / "references" / "deepsearch-playbook.md").read_text(encoding="utf-8")
    slide_patterns_text = (root / "preset-ppt" / "references" / "slide-patterns.md").read_text(encoding="utf-8")
    visual_checklist_text = (root / "presentation-design" / "references" / "visual-checklist.md").read_text(encoding="utf-8")

    assert "300–550 行" not in web_text
    assert "3–6 句" not in emo_text and "篇幅限制" in emo_text
    assert "12356" in emo_text and "depends_on:" not in emo_text
    assert "3–5 句直答" not in deepsearch_text
    assert "超过 120 字" not in slide_patterns_text
    assert "克制" not in doc_brief_text
    assert "克制" not in visual_checklist_text


def test_execution_profile_pruning_two_tier_catalog_and_reasoning_event(tmp_path):
    from app.domain.models.event import TurnEvent, TurnPhase
    from app.domain.services.run_budget import BudgetPhase
    from app.domain.services.skill_context import catalog_message
    from app.domain.services.tools.a2a import A2ATool
    from app.domain.services.tools.mcp import MCPTool
    from tests.support.scripted_llm import ScriptedResponse

    # 1. dialogue 档位无非图片附件时裁剪全部工具，跳过 plan notices / task state，且 TurnEvent 持久化 reasoning_content
    h_dialog = make_loop([ScriptedResponse(content="我在这里陪你。", reasoning_content="先共情接住情绪，再轻柔回应。")])
    h_dialog.loop._execution_profile = "dialogue"
    events_dialog = asyncio.run(
        asyncio.wait_for(_collect(h_dialog.loop.invoke(Message(message="好累"))), timeout=5)
    )
    assert h_dialog.llm.requests[0].tools == []
    assert not any("[计划核对]" in str(m.get("content") or "") or "[任务状态]" in str(m.get("content") or "")
                   for m in h_dialog.llm.requests[0].messages)
    completed_turns = [e for e in events_dialog if isinstance(e, TurnEvent) and e.phase == TurnPhase.COMPLETED]
    assert len(completed_turns) == 1
    assert completed_turns[0].reasoning_content == "先共情接住情绪，再轻柔回应。"

    # 有非图片附件时，dialogue 档位仅开放 read_document 与 read_file
    h_attach = make_loop([text("已读取附件。")])
    h_attach.loop._execution_profile = "dialogue"
    _ = asyncio.run(asyncio.wait_for(_collect(h_attach.loop.invoke(Message(message="帮我看下", attachments=["notes.txt"]))), timeout=5))
    tool_names_attach = {t["function"]["name"] for t in h_attach.llm.requests[0].tools}
    assert tool_names_attach == {"read_document", "read_file"}

    # 未配置 MCP/A2A 时隐藏 discover_mcp_tools / get_remote_agent_cards / call_remote_agent；非 FINALIZE 隐藏 finalize_artifact
    class _DummyGW:
        config = AppConfig(llm_config=LLMConfig(), agent_config=AgentConfig(), mcp_config=MCPConfig(), a2a_config=A2AConfig()).mcp_config
    class _DummyA2AGW:
        config = A2AConfig()
    h_prune = make_loop(
        [text("done")],
        extra_tools=[
            MCPTool(_DummyGW()),
            A2ATool(_DummyA2AGW()),
        ],
    )
    h_prune.loop._has_mcp_override = False
    h_prune.loop._has_a2a_override = False
    pruned_names = {t["function"]["name"] for t in h_prune.loop._tool_schemas()}
    assert "discover_mcp_tools" not in pruned_names
    assert "get_remote_agent_cards" not in pruned_names
    assert "call_remote_agent" not in pruned_names
    assert "finalize_artifact" not in pruned_names
    h_prune.loop._budget_phase = BudgetPhase.FINALIZE
    assert "finalize_artifact" in {t["function"]["name"] for t in h_prune.loop._tool_schemas()}

    # 2. 两级渐进式 Skill 目录：超过 12 项时只内联子集并暴露 search_skills；dialogue 跳过目录
    async def scenario(uow_factory, read_factory, database):
        s = _build_skill_service(database, tmp_path)
        await s.initialize()
        # 测试 initialize 清理已下线内置 skill，以及 default_included 同步（覆盖未显式覆盖的记录，保留 overridden=True）
        async with s.repository.transaction() as tx:
            await tx.put("skills", "elicitation-communication", {
                "id": "elicitation-communication", "name": "elicitation-communication",
                "builtin": True, "enabled": True, "included": True, "version": "v1",
            })
            ppt_row = await tx.get("skills", "preset-ppt")
            excel_row = await tx.get("skills", "preset-excel")
            assert ppt_row is not None and excel_row is not None
            await tx.put("skills", "preset-ppt", {**ppt_row, "included": False, "default_included": False, "included_overridden": False})
            await tx.put("skills", "preset-excel", {**excel_row, "included": False, "default_included": False, "included_overridden": True})
        await s.initialize()
        after_init = {e["id"]: e for e in await s.list()}
        assert "elicitation-communication" not in after_init
        assert after_init["preset-ppt"]["included"] is True
        assert after_init["preset-excel"]["included"] is False

        sessions = SessionService(uow_factory, read_uow_factory=read_factory, skills=s)
        session_obj = await sessions.create_session()
        ledger = RunLedger(uow_factory, MemoryNotifier())
        r_dialog = await ledger.start(session_obj.id)

        # dialogue 档位不向模型发送 <available_skills>
        rt_dialog = SkillRuntime(s, r_dialog.id, local_command_available=False, execution_profile="dialogue")
        await rt_dialog.initialize(frozen=False)
        assert await rt_dialog.context(query_text="好累") == []
        await ledger.transition(session_obj.id, r_dialog.id, RunStatus.COMPLETED)

        # 再安装 8 个自定义 skill，使 included 总数超过 12
        for idx in range(8):
            desc = f"专项技能 {idx} 合同审阅" if idx == 5 else f"常规技能 {idx}"
            raw_skill = f"---\nname: custom-skill-{idx}\ndescription: {desc}\n---\n\n{desc}\n".encode()
            await install(s, {"SKILL.md": raw_skill})
        r_tier = await ledger.start(session_obj.id)
        rt = SkillRuntime(s, r_tier.id, local_command_available=False, execution_profile="workspace_task")
        await rt.initialize(frozen=False)
        blocks = await rt.context(query_text="合同")
        assert len(blocks) == 1 and "search_skills" in blocks[0]["content"]
        assert "custom-skill-5" in blocks[0]["content"]
        tool = SkillTool(rt)
        exposed = {t["function"]["name"] for t in tool.get_tools()}
        assert "search_skills" in exposed
        assert "prepare_skill_resources" not in exposed  # local_command_available=False
        search_res = await rt.search("合同")
        assert search_res.success and search_res.data["items"][0]["name"] == "custom-skill-5"

        # 确认超过上限的 catalog_message 本身保持精简
        bound = await s.bindings(r_tier.id)
        cat = catalog_message(r_tier.id, bound, query_text="合同")["content"]
        assert len(cat) < 8000

    with_database(tmp_path, scenario)


async def _collect(agen):
    return [item async for item in agen]
