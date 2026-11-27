"""协调评测、保存阶段结果，并将交付件移交给现有文件预览。"""
from __future__ import annotations

import asyncio
import logging
import sys
import tempfile
from contextlib import AsyncExitStack
from pathlib import Path
from uuid import UUID

from app.application.errors.exceptions import BadRequestError, ConflictError, NotFoundError
from app.application.services.evaluation_cases import CASES, SUITE_VERSION
from app.domain.models.clock import utc_now
from app.domain.models.evaluation import (
    EvaluationArtifact, EvaluationBatch, EvaluationCatalog, EvaluationOverview, EvaluationResult, EvaluationStart,
)
from app.infrastructure.external.evaluation.sidecar import EvaluationExecutionError, available_versions, open_core

logger = logging.getLogger(__name__)


class EvaluationService:
    def __init__(self, root: Path, save_artifact, get_sampling):
        self.root = root
        self.save_artifact = save_artifact
        self.get_sampling = get_sampling
        self.task: asyncio.Task | None = None
        self.active: UUID | None = None

    def _path(self, batch_id: UUID) -> Path:
        return self.root / f"{batch_id}.json"

    def _write(self, batch: EvaluationBatch) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        path = self._path(batch.id)
        pending = path.with_suffix(".tmp")
        pending.write_text(batch.model_dump_json(), encoding="utf-8")
        pending.replace(path)

    def get(self, batch_id: UUID) -> EvaluationBatch:
        try:
            batch = EvaluationBatch.model_validate_json(self._path(batch_id).read_bytes())
        except FileNotFoundError as error:
            raise NotFoundError("评测批次不存在") from error
        if batch.state == "running" and batch_id != self.active:
            batch.state = "interrupted"
            batch.current = None
            batch.error = "评测在核心关闭期间中断，已完成的用例仍可查看"
            self._write(batch)
        return batch

    def overview(self) -> EvaluationOverview:
        candidate, baseline = available_versions()
        paths = sorted(self.root.glob("*.json"), key=lambda path: path.stat().st_mtime, reverse=True)
        batches = [self.get(UUID(path.stem)) for path in paths[:30]]
        return EvaluationOverview(
            catalog=EvaluationCatalog(cases=[case.info for case in CASES.values()],
                                      candidate=candidate.label, baseline=baseline.label if baseline else None),
            batches=batches,
        )

    def start(self, body: EvaluationStart) -> EvaluationBatch:
        if self._path(body.request_id).exists():
            prior = self.get(body.request_id)
            if prior.model != body.model or prior.cases != body.cases or prior.repeats != body.repeats or prior.reference_id != body.reference_id or bool(prior.baseline) != (body.compare or body.reference_id is not None):
                raise ConflictError("同一请求标识已经用于其他评测条件")
            return prior
        if self.active is not None:
            raise ConflictError("已有评测在运行")
        if len(set(body.cases)) != len(body.cases):
            raise BadRequestError("请只选择一次每个用例")
        if body.compare and body.reference_id is not None:
            raise BadRequestError("请选择一种基准来源")
        candidate, baseline = available_versions()
        if body.compare and baseline is None:
            raise BadRequestError("未配置可运行的旧构建，请选择已有结果作基准")
        reference = self.get(body.reference_id) if body.reference_id else None
        if reference is not None and (
            reference.state != "completed" or reference.suite_version != SUITE_VERSION
            or reference.model != body.model or reference.cases != body.cases or reference.repeats != body.repeats
            or len([r for r in reference.results if r.side == "candidate" and r.outcome != "error"]) != len(body.cases) * body.repeats
        ):
            raise BadRequestError("参照结果需要相同用例、模型及运行次数，并已完成本轮用例核验")
        batch = EvaluationBatch(
            id=body.request_id, created_at=utc_now(), state="running", model=body.model,
            cases=body.cases, repeats=body.repeats, candidate=candidate.label,
            baseline=reference.candidate if reference else baseline.label if body.compare and baseline else None,
            reference_id=body.reference_id, suite_version=SUITE_VERSION, current="准备独立评测环境",
        )
        self._write(batch)
        self.active = batch.id
        self.task = asyncio.create_task(self._run(batch, candidate, baseline if body.compare else None, reference))
        return batch

    async def _run(self, batch, candidate, baseline, reference) -> None:
        try:
            sampling = await self.get_sampling(batch.model)
            # macOS 的 Unix socket 路径需要明显短于应用数据根下的深层路径。
            short_root = "/tmp" if sys.platform == "darwin" else None
            with tempfile.TemporaryDirectory(prefix="ray-eval-", dir=short_root) as directory:
                root = Path(directory)
                async with AsyncExitStack() as stack:
                    current = await stack.enter_async_context(open_core(candidate, root / "candidate"))
                    old = await stack.enter_async_context(open_core(baseline, root / "baseline")) if baseline else None
                    if old:
                        versions = await asyncio.gather(current.model(batch.model), old.model(batch.model))
                        for field, limit in (("context_window", "context_window"), ("max_tokens", "max_output")):
                            sampling[field] = min(sampling[field], *(version[limit] for version in versions))
                    elif reference and reference.sampling:
                        sampling = dict(reference.sampling)
                    batch.sampling = sampling
                    batch.conditions = await current.setup(batch.model, sampling)
                    if old and await old.setup(batch.model, sampling) != batch.conditions:
                        raise EvaluationExecutionError("两版模型配置无法对齐")
                    if reference:
                        if reference.conditions != batch.conditions:
                            raise EvaluationExecutionError("模型采样条件已变化，请用当前条件重新生成基准")
                        batch.results.extend(r.model_copy(update={"side": "baseline"}) for r in reference.results if r.side == "candidate")
                    self._write(batch)
                    for repetition in range(1, batch.repeats + 1):
                        for case_id in batch.cases:
                            sides = [("baseline", old), ("candidate", current)] if old else [("candidate", current)]
                            if repetition % 2 == 0:
                                sides.reverse()
                            for side, core in sides:
                                case = CASES[case_id]
                                batch.current = f"{'基准' if side == 'baseline' else '当前'} · {case.info.title} · 第 {repetition} 次"
                                self._write(batch)
                                result = await self._case(batch, case_id, side, repetition, core)
                                batch.results.append(result)
                                self._write(batch)
            batch.state = "completed"
        except asyncio.CancelledError:
            batch.state = "cancelled"
        except EvaluationExecutionError as error:
            batch.state = "failed"
            batch.error = str(error)
        except Exception:
            logger.exception("评测批次失败 %s", batch.id)
            batch.state = "failed"
            batch.error = "评测环境未能完成，已完成的结果仍可查看"
        finally:
            batch.current = None
            self.active = None
            self._write(batch)

    async def _case(self, batch, case_id, side, repetition, core) -> EvaluationResult:
        case = CASES[case_id]
        result = EvaluationResult(case_id=case_id, side=side, repetition=repetition, outcome="error")
        try:
            run = await core.run(case.prompt, case.materials, batch.model)
            result.run_id = run.run.get("run_id")
            result.metrics = run.metrics()
            result.reply = next((e["data"].get("message") for e in reversed(run.events)
                                 if e["event"] == "message" and e["data"].get("role") == "assistant" and e["data"].get("message")), None)
            result.checks = await asyncio.to_thread(case.verify, run.files)
            for name, content in run.files.items():
                file = await self.save_artifact(name, content)
                result.artifacts.append(EvaluationArtifact(file_id=file.id, filename=file.filename))
            status = run.run.get("status")
            if run.timeout:
                result.note = "超过用例时限，已向核心请求停止"
            elif status == "waiting":
                result.note = "运行等待提问或审批，未完成固定用例"
                result.outcome = "failed"
            elif status == "completed":
                passed = all(check.passed for check in result.checks)
                result.outcome = "passed" if passed else "failed"
            else:
                failure = next((e["data"].get("error") for e in reversed(run.events) if e["event"] == "error"), None)
                result.note = failure or ("运行未完成：" + str(run.run.get("reason") or status or "状态未知"))
        except EvaluationExecutionError as error:
            result.note = str(error)
        except Exception:
            logger.exception("评测用例 %s 保存或读取失败", case_id)
            result.note = "读取或核验该用例时出错"
        return result

    async def cancel(self, batch_id: UUID) -> EvaluationBatch:
        if self.active == batch_id and self.task is not None:
            self.task.cancel()
            await asyncio.gather(self.task, return_exceptions=True)
            if self.active == batch_id:
                # 任务尚未进入协程主体时，取消不会运行其 finally。
                batch = self.get(batch_id)
                batch.state = "cancelled"
                batch.current = None
                self.active = None
                self._write(batch)
        return self.get(batch_id)

    async def close(self) -> None:
        if self.active is not None:
            await self.cancel(self.active)
