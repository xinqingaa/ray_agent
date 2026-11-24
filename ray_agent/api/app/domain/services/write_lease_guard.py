"""工作区写入租约连续冲突熔断：同一占用持续阻止工作区写入时，防止模型连续盲目重试。"""
from __future__ import annotations

from typing import Any, Optional

from app.domain.external.workspace_files import WorkspaceFileError
from app.domain.models.error import ErrorCode
from app.domain.models.identity import RootKind
from app.domain.models.tool_result import ToolResult
from app.domain.services.file_scope import FileScope
from app.domain.services.flows.tool_pipeline import ToolInvocation

LEASE_CONFLICT_LIMIT = 2


class WriteLeaseConflictGuard:
    """按运行记录同一工作区写入租约的连续冲突，达到上限后短路工作区写操作与 Shell 重试。"""

    def __init__(self, files: Optional[FileScope], outcomes: Any = None,
                 limit: int = LEASE_CONFLICT_LIMIT) -> None:
        self._files = files
        self._outcomes = outcomes
        self._limit = max(1, int(limit))
        self._conflict_key: Optional[tuple[str, str]] = None
        self._count: int = 0
        self._last_lease: Optional[dict[str, Any]] = None

    def reset(self) -> None:
        self._conflict_key = None
        self._count = 0
        self._last_lease = None

    def _has_gated_workspace(self) -> bool:
        if self._files is None:
            return False
        return any(root.kind is RootKind.WORKSPACE_FOLDER for root in self._files.roots)

    def _targets_gated_workspace(self, invocation: ToolInvocation) -> bool:
        if not self._has_gated_workspace() or self._files is None:
            return False
        name = invocation.function_name
        if name == "shell_execute":
            return True
        if name == "finalize_artifact":
            path = invocation.arguments.get("filepath") or invocation.arguments.get("path")
            if not path and self._outcomes is not None:
                artifact = self._outcomes.artifact(invocation.arguments.get("artifact_id"))
                path = artifact.path if artifact else None
        elif name in ("write_file", "replace_in_file"):
            path = invocation.arguments.get("filepath") or invocation.arguments.get("path")
        else:
            return False
        if not isinstance(path, str) or not path.strip():
            return False
        try:
            rooted = self._files.resolve(path)
        except WorkspaceFileError:
            return False
        return self._files.is_gated(rooted) or self._files.root(rooted.root_id).kind is RootKind.WORKSPACE_FOLDER

    async def before(self, invocation: ToolInvocation) -> Optional[ToolResult]:
        if invocation.suspended or self._count < self._limit:
            return None
        if not self._targets_gated_workspace(invocation):
            return None
        lease = self._last_lease or {}
        who = f"会话 {lease.get('owner_session_id')}" if lease.get("owner_session_id") else "另一个写入者"
        reason = f"（{lease.get('reason')}）" if lease.get("reason") else ""
        details = {"lease": dict(lease)} if lease else None
        data: dict[str, Any] = {"code": ErrorCode.CONFLICT.value, "circuit_open": True}
        if details is not None:
            data["details"] = details
        return ToolResult(
            success=False,
            message=(
                f"工作区文件夹仍被{who}占用{reason}，本次运行已熔断继续重试工作区写入与 Shell 执行。"
                "请勿继续重试，也不要要求用户终止另一个会话；请改为继续只读分析，"
                "或将产物写入会话工作目录并通过 deliver_files 交付。"
            ),
            data=data,
        )

    async def after(self, invocation: ToolInvocation, result: ToolResult) -> ToolResult:
        if invocation.short_circuited:
            return result
        if result.success:
            if self._targets_gated_workspace(invocation):
                self.reset()
            return result
        data = result.data if isinstance(result.data, dict) else None
        if not data or data.get("code") != ErrorCode.CONFLICT.value:
            return result
        details = data.get("details")
        lease = details.get("lease") if isinstance(details, dict) else None
        if not isinstance(lease, dict):
            return result
        if not self._targets_gated_workspace(invocation):
            return result
        key = (
            str(lease.get("id") or ""),
            str(lease.get("owner_session_id") or lease.get("owner_run_id") or ""),
        )
        if key != self._conflict_key:
            self._conflict_key = key
            self._count = 1
        else:
            self._count += 1
        self._last_lease = dict(lease)
        if self._count >= self._limit:
            notice = (
                "已连续遇到同一工作区写入占用冲突，本次运行已熔断后续工作区写入与 Shell 重试。"
                "请勿继续重试，也不要要求用户终止另一个会话；请改为继续只读分析，"
                "或将产物写入会话工作目录并通过 deliver_files 交付。"
            )
            message = f"{result.message}；{notice}" if result.message else notice
            return ToolResult(success=False, message=message, data={**data, "circuit_open": True})
        return result
