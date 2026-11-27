import asyncio
from contextlib import asynccontextmanager
from types import SimpleNamespace
from uuid import uuid4

from app.application.services import evaluation_service
from app.application.services.evaluation_cases import verify_brief, verify_excel, verify_ppt
from app.application.services.evaluation_service import EvaluationService
from app.domain.models.evaluation import EvaluationStart
from app.infrastructure.external.evaluation.sidecar import CaseRun, CoreVersion

BRIEF = "15 分钟与陈希确认：周三客户期限不变，只调整内部评审，周五复访。"


def test_verification_uses_delivered_bytes_and_fixed_page_width():
    assert all(check.passed for check in verify_brief({"提纲.md": BRIEF.encode()}))
    overlong = BRIEF + "\n" + "\n".join(["甲" * 65] * 10)
    assert not next(check for check in verify_brief({"提纲.md": overlong.encode()}) if check.label == "符合一页限制").passed
    assert not verify_brief({})[0].passed
    assert not verify_excel({"损坏.xlsx": b"bad bytes"})[0].passed
    assert [check.passed for check in verify_ppt({})] == [False, False]


def test_both_builds_and_saved_reference_compare_with_independent_artifacts(tmp_path, monkeypatch):
    async def run_scenario():
        current = CoreVersion("current", ())
        previous = CoreVersion("previous", ())
        monkeypatch.setattr(evaluation_service, "available_versions", lambda: (current, previous))
        opened, sampling, imported = [], [], []

        class Core:
            async def model(self, model):
                return {"context_window": 20000, "max_output": 4096}

            async def setup(self, model, profile):
                sampling.append(profile.copy())
                return str(profile)

            async def run(self, prompt, materials, model):
                assert "会前材料.md" in materials
                return CaseRun({"status": "completed", "run_id": str(uuid4())}, [], {"会前提纲.md": BRIEF.encode()}, 1000)

        @asynccontextmanager
        async def executable(version, root):
            opened.append((version.label, root))
            yield Core()

        async def save(name, body):
            assert body == BRIEF.encode()
            identifier = str(uuid4())
            imported.append(identifier)
            return SimpleNamespace(id=identifier, filename=name)

        async def profile(model):
            return {"context_window": 40000, "max_tokens": 8192, "temperature": 0.7}

        monkeypatch.setattr(evaluation_service, "open_core", executable)
        service = EvaluationService(tmp_path, save, profile)
        original = service.start(EvaluationStart(model="selected", cases=["brief"], compare=True, request_id=uuid4()))
        await service.task
        first = service.get(original.id)
        assert first.state == "completed"
        assert [item.side for item in first.results] == ["baseline", "candidate"]
        assert all(item.outcome == "passed" for item in first.results)
        assert opened[0][1] != opened[1][1]
        assert all(len(str(path.resolve() / "execution/supervisor.sock").encode()) < 104 for _, path in opened)
        assert sampling[0] == sampling[1] == {"context_window": 20000, "max_tokens": 4096, "temperature": 0.7}

        second_body = EvaluationStart(model="selected", cases=["brief"], request_id=uuid4(), reference_id=first.id)
        second = service.start(second_body)
        await service.task
        assert service.start(second_body).id == second.id
        results = service.get(second.id).results
        assert len(opened) == 3
        assert results[0].artifacts[0].file_id == imported[1]
        assert results[1].artifacts[0].file_id == imported[2]

    asyncio.run(run_scenario())


def test_restart_preserves_prior_results_but_does_not_requeue_paid_tasks(tmp_path):
    from app.domain.models.evaluation import EvaluationBatch
    from app.domain.models.clock import utc_now

    service = EvaluationService(tmp_path, None, None)
    batch = EvaluationBatch(id=uuid4(), created_at=utc_now(), state="running", model="selected",
                            cases=["brief"], repeats=3, candidate="new", suite_version="office-v1",
                            current="处理中")
    service._write(batch)
    result = service.get(batch.id)
    assert result.state == "interrupted"
    assert result.current is None
    assert service.active is None


def test_chat_uses_model_and_matching_reasoning_choice():
    import json

    import httpx

    from app.infrastructure.external.evaluation.sidecar import EvaluationCore

    async def run_scenario():
        def answer(request):
            if request.url.path == "/sessions":
                return httpx.Response(200, json={"data": {"session_id": "evaluation-session"}})
            if request.url.path.endswith("/chat"):
                payload = json.loads(request.content)
                assert payload["model"] == "a-model"
                assert payload["reasoning"] == "medium"
                return httpx.Response(200, json={"data": {"run_id": "evaluation-run"}})
            assert request.url.path == "/sessions/evaluation-session"
            return httpx.Response(200, json={"data": {
                "runs": [{"run_id": "evaluation-run", "status": "completed"}], "events": [],
            }})

        async with httpx.AsyncClient(base_url="http://localhost", transport=httpx.MockTransport(answer)) as client:
            core = EvaluationCore(client)
            core.reasoning = "medium"
            result = await core.run("任务", {}, "a-model")
            assert result.run["run_id"] == "evaluation-run"

    asyncio.run(run_scenario())
