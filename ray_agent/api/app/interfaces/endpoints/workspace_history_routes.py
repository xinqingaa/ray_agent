"""工作区文件夹的写入租约、最近修改的运行、撤销本次修改与外部变更推送。"""
from typing import AsyncGenerator, Optional

from fastapi import APIRouter, Depends, Query
from sse_starlette import ServerSentEvent

from app.application.errors.workspace_files import app_error
from app.application.services.file_history import FileHistoryService, ForceCurrent, UndoItem
from app.application.services.workspace_changes import WorkspaceChangeFeed
from app.application.services.workspace_service import WorkspaceService
from app.application.services.write_leases import WriteLeaseService
from app.domain.external.workspace_files import WorkspaceFileError
from app.interfaces.schemas import Response
from app.interfaces.streaming import EventStreamResponse
from app.interfaces.schemas.workspace_changes import (
    ChangePreviewResponse, ModifiedRunsResponse, RunChangesResponse, UndoItemResult, UndoRequest, UndoResponse,
    WriteLeaseResponse, WriteLeaseView, ConfirmLeaseReleaseRequest, run_summary_view,
)
from app.interfaces.service_dependencies import (
    get_change_feed, get_file_history, get_workspace_service, get_write_leases, get_shell_changes,
)
from app.application.services.shell_changes import ShellChanges
from app.interfaces.schemas.shell_changes import ShellChangesResponse

router = APIRouter(prefix="/workspaces", tags=["工作区文件变更"])


@router.get('/{workspace_id}/runs/{run_id}/shell-changes', response_model=Response[ShellChangesResponse],
            summary='工作区运行的 Shell 文件观察')
async def shell_changes(workspace_id: str, run_id: str, offset: int = Query(default=0, ge=0),
                        limit: int | None = Query(default=None, ge=1, le=2000),
                        changes: ShellChanges = Depends(get_shell_changes)):
    from core.config import get_settings
    return Response.success(ShellChangesResponse(**await changes.workspace_view(
        workspace_id, run_id, offset=offset, limit=limit or get_settings().file_list_entries)))


async def _known(workspace_id: str, service: WorkspaceService) -> None:
    await service.get(workspace_id, refresh=False)


@router.get("/{workspace_id}/write-lease", response_model=Response[WriteLeaseResponse], summary="文件夹写入租约",
            description="文件夹当前的写入者；没有租约表示没有写入者。其他会话的写入被占用时得到 409，details.lease 带同样信息。")
async def get_write_lease(workspace_id: str, service: WorkspaceService = Depends(get_workspace_service),
                          leases: WriteLeaseService = Depends(get_write_leases)):
    await _known(workspace_id, service)
    lease = await leases.get(workspace_id)
    return Response.success(WriteLeaseResponse(lease=WriteLeaseView.of(lease) if lease else None))


@router.post("/{workspace_id}/write-lease/retry-settle", response_model=Response[WriteLeaseResponse],
             summary="重试写入租约收尾",
             description="租约处于 settling 或 blocked（停止后未能确认写入结束）时，再次要求写入者退出并确认；"
                         "确认后释放租约，仍未确认返回 409 并保持阻止状态。正常写入中的租约不可收尾（409）。")
async def retry_settle(workspace_id: str, service: WorkspaceService = Depends(get_workspace_service),
                       leases: WriteLeaseService = Depends(get_write_leases)):
    await _known(workspace_id, service)
    try:
        await leases.retry_settle(workspace_id)
    except WorkspaceFileError as error:
        raise app_error(error)
    return Response.success(WriteLeaseResponse(lease=None))


@router.post("/{workspace_id}/write-lease/confirm-release", response_model=Response[WriteLeaseResponse],
             summary="确认未知旧进程已结束并释放占用")
async def confirm_release(workspace_id: str, body: ConfirmLeaseReleaseRequest,
                          service: WorkspaceService = Depends(get_workspace_service),
                          leases: WriteLeaseService = Depends(get_write_leases)):
    await _known(workspace_id, service)
    try:
        await leases.confirm_release(workspace_id, body.lease_id)
    except WorkspaceFileError as error:
        raise app_error(error)
    return Response.success(WriteLeaseResponse(lease=None))


@router.get("/{workspace_id}/modified-runs", response_model=Response[ModifiedRunsResponse],
            summary="最近修改过文件夹的运行",
            description="按最近修改时间倒序，供文件夹面板展示「最近一次修改」入口；只含有净变化的运行")
async def modified_runs(workspace_id: str, limit: Optional[int] = Query(default=None, ge=1, le=100),
                        history: FileHistoryService = Depends(get_file_history)):
    runs = await history.recent_runs(workspace_id, limit)
    return Response.success(ModifiedRunsResponse(runs=[run_summary_view(run) for run in runs]))


@router.get("/{workspace_id}/runs/{run_id}/changes", response_model=Response[RunChangesResponse],
            summary="一次运行在文件夹里的文件变更",
            description="每个文件给出运行前版本、运行最后写入版本、当前版本与撤销状态（undoable/restored/conflict）；"
                        "run_active 为真时不能撤销")
async def run_changes(workspace_id: str, run_id: str, history: FileHistoryService = Depends(get_file_history)):
    return Response.success(RunChangesResponse.of(await history.changes(workspace_id, run_id)))


@router.get("/{workspace_id}/runs/{run_id}/changes/preview", response_model=Response[ChangePreviewResponse],
            summary="预览撤销后的内容",
            description="当前版本到撤销后版本的统一 diff；二进制或超过预览上限的文件只返回大小")
async def preview_change(workspace_id: str, run_id: str, path: str = Query(min_length=1, description="相对文件夹的路径"),
                         history: FileHistoryService = Depends(get_file_history)):
    return Response.success(ChangePreviewResponse.of(await history.preview(workspace_id, run_id, path)))


@router.post("/{workspace_id}/runs/{run_id}/undo", response_model=Response[UndoResponse],
             summary="撤销本次修改",
             description="只处理选中的文件，逐个返回结果：restored/removed 已处理，unchanged 本来就是运行前状态，"
                         "conflict 文件在运行之后被改动（带当前版本；can_force 时可带 force=当前版本再次提交以仍要恢复），"
                         "failed 其他原因。恢复与移除前会备份当前版本，并占用文件夹写入租约；"
                         "租约被占用、运行仍在进行或工作区不可写时整体返回 409。撤销不回滚会话与记忆。")
async def undo_run(workspace_id: str, run_id: str, request: UndoRequest,
                   history: FileHistoryService = Depends(get_file_history)):
    items = [UndoItem(relative_path=item.relative_path,
                      force=ForceCurrent(item.force.exists, item.force.size,
                                         int(item.force.modified_ns) if item.force.modified_ns is not None else None)
                      if item.force is not None else None) for item in request.items]
    outcomes = await history.undo(workspace_id, run_id, items)
    return Response.success(UndoResponse(results=[UndoItemResult.of(outcome) for outcome in outcomes]))


@router.get("/{workspace_id}/changes/stream", summary="订阅文件夹的外部变更",
            description="SSE：先推送 ready（当前是否可用），之后推送 changed（paths 为变化的相对路径，refresh 为真表示需要整体刷新）"
                        "与 availability（文件夹失联或恢复）。应用自己的写入同样会触发 changed。"
                        "只在有订阅者时监视；通知之外还有定期重扫兜底。事件数据见 WorkspaceChangeEvent。")
async def stream_changes(workspace_id: str, service: WorkspaceService = Depends(get_workspace_service),
                         feed: WorkspaceChangeFeed = Depends(get_change_feed)) -> EventStreamResponse:
    await _known(workspace_id, service)

    async def events() -> AsyncGenerator[ServerSentEvent, None]:
        async for event in feed.stream(workspace_id):
            yield ServerSentEvent(event=event.kind, data=event.model_dump_json())

    return EventStreamResponse(events(), ping=15)
