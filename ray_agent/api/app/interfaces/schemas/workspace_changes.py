"""写入租约、一次运行的文件变更与撤销、外部变更推送的契约；时间为毫秒时间戳，文件位置是相对工作区文件夹的路径。"""
from typing import Annotated, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

from app.application.services.file_history import (
    ChangeEntry, ChangePreview, RunChangeList, RunSummary, UndoOutcome, Version,
)
from app.domain.models.file_change import ChangeOperation
from app.domain.models.write_lease import LeaseState, WriteLease, WriterKind
from app.interfaces.schemas.event import to_epoch_ms

_STRICT = ConfigDict(json_schema_serialization_defaults_required=True)
NanosecondStamp = Annotated[str, Field(pattern=r"^-?[0-9]+$", max_length=21)]


class WriteLeaseView(BaseModel):
    """文件夹当前的写入租约；被占用时其他会话的写入立即得到带这些信息的 409。"""
    model_config = _STRICT

    id: str
    state: LeaseState = Field(description="preparing/held 正常写入中；settling 已请求停止；blocked 停止后未能确认写入结束，需重试收尾")
    writer_kind: WriterKind
    owner_session_id: str = Field(description="持有者会话；上传等不属于会话的写入为空串")
    owner_run_id: Optional[str] = None
    operation: Optional[str] = None
    reason: str
    acquired_at: int
    updated_at: int

    @classmethod
    def of(cls, lease: WriteLease) -> "WriteLeaseView":
        return cls(id=lease.id, state=lease.state, writer_kind=lease.writer_kind,
                   owner_session_id=lease.owner_session_id, owner_run_id=lease.owner_run_id,
                   operation=lease.operation, reason=lease.reason, acquired_at=to_epoch_ms(lease.acquired_at),
                   updated_at=to_epoch_ms(lease.updated_at))


class WriteLeaseResponse(BaseModel):
    model_config = _STRICT

    lease: Optional[WriteLeaseView] = Field(default=None, description="没有租约表示文件夹当前没有写入者")


class FileVersionView(BaseModel):
    model_config = _STRICT

    size: int
    modified_ns: Optional[NanosecondStamp] = Field(default=None, description="十进制字符串，仍要恢复时原样回传，避免 JavaScript 数字丢失纳秒精度")
    sha256: Optional[str] = None

    @classmethod
    def of(cls, version: Optional[Version]) -> Optional["FileVersionView"]:
        return cls(size=version.size, modified_ns=str(version.modified_ns) if version.modified_ns is not None else None,
                   sha256=version.sha256) if version else None


class RunSummaryView(BaseModel):
    model_config = _STRICT

    run_id: str
    session_id: str
    session_title: str
    run_status: str
    changed_files: int = Field(description="净变化的文件数；运行里新建后又删除的文件不计")
    first_at: int
    last_at: int
    kind: Literal["run", "undo"] = Field(
        default="run", description="run：Agent 运行；undo：一次撤销操作，它的 run_id 是操作身份，可像运行一样查看变更并撤回")
    undo_of_run_id: Optional[str] = Field(default=None, description="kind=undo 时被撤销的运行")


class ModifiedRunsResponse(BaseModel):
    model_config = _STRICT

    runs: list[RunSummaryView]


class ChangeEntryView(BaseModel):
    model_config = _STRICT

    root_id: str
    relative_path: str
    operation: ChangeOperation = Field(description="折叠后的净操作：运行前不存在为 create，运行前存在且最后被删除为 delete，其余为 modify")
    writes: int = Field(description="运行对该文件的写入次数")
    first_at: int
    last_at: int
    before: Optional[FileVersionView] = Field(default=None, description="运行前版本；create 为空")
    after: Optional[FileVersionView] = Field(default=None, description="运行最后写入的版本；delete 为空")
    current: Optional[FileVersionView] = Field(default=None, description="文件夹里当前的版本；不存在为空")
    status: Literal["undoable", "restored", "conflict"] = Field(
        description="undoable：当前版本仍是运行最后写入的，可直接撤销；restored：已经是运行前状态；"
                    "conflict：之后被改动过，只有明确仍要恢复才会覆盖")
    conflict_reason: Optional[Literal["modified", "missing", "appeared", "not_file", "modified_during_run"]] = None
    can_force: bool = Field(description="冲突时是否允许仍要恢复；运行新建的文件与非普通文件不允许")
    preview_kind: Literal["restore", "remove"] = Field(description="撤销会恢复运行前内容，或移除运行新建的文件")

    @classmethod
    def of(cls, entry: ChangeEntry) -> "ChangeEntryView":
        return cls(root_id=entry.root_id, relative_path=entry.relative_path, operation=entry.operation,
                   writes=entry.writes, first_at=to_epoch_ms(entry.first_at), last_at=to_epoch_ms(entry.last_at),
                   before=FileVersionView.of(entry.before), after=FileVersionView.of(entry.after),
                   current=FileVersionView.of(entry.current), status=entry.status,
                   conflict_reason=entry.conflict_reason, can_force=entry.can_force, preview_kind=entry.preview_kind)


class RunChangesResponse(BaseModel):
    model_config = _STRICT

    run_id: str
    session_id: str
    session_title: str
    run_active: bool = Field(description="运行仍在进行时不能撤销")
    kind: Literal["run", "undo"] = "run"
    undo_of_run_id: Optional[str] = None
    entries: list[ChangeEntryView]

    @classmethod
    def of(cls, changes: RunChangeList) -> "RunChangesResponse":
        return cls(run_id=changes.run_id, session_id=changes.session_id, session_title=changes.session_title,
                   run_active=changes.run_active, kind=changes.kind, undo_of_run_id=changes.undo_of_run_id,
                   entries=[ChangeEntryView.of(entry) for entry in changes.entries])


class ChangePreviewResponse(BaseModel):
    model_config = _STRICT

    kind: Literal["diff", "binary", "too_large", "unchanged"] = Field(
        description="diff：当前版本到撤销后版本的统一 diff；binary 与 too_large 只给大小；unchanged：撤销不会改变内容")
    diff: str = ""
    truncated: bool = False
    current_size: Optional[int] = None
    restore_size: Optional[int] = None
    removes_file: bool = Field(description="撤销会移除文件（运行新建的文件）")
    warning: str = Field(default="", description="撤销会丢掉运行期间的外部修改等需要用户知道的情况；为空表示没有")

    @classmethod
    def of(cls, preview: ChangePreview) -> "ChangePreviewResponse":
        return cls(kind=preview.kind, diff=preview.diff, truncated=preview.truncated,
                   current_size=preview.current_size, restore_size=preview.restore_size,
                   removes_file=preview.removes_file, warning=preview.warning)


class ForceCurrentRequest(BaseModel):
    """用户看到的当前版本；与实际不一致时不覆盖，重新返回冲突。"""
    exists: bool
    size: Optional[int] = None
    modified_ns: Optional[NanosecondStamp] = None


class UndoItemRequest(BaseModel):
    relative_path: str = Field(min_length=1)
    force: Optional[ForceCurrentRequest] = Field(default=None, description="仍要恢复：带上冲突结果里的当前版本")


class UndoRequest(BaseModel):
    items: list[UndoItemRequest] = Field(min_length=1, max_length=500)


class UndoItemResult(BaseModel):
    model_config = _STRICT

    relative_path: str
    status: Literal["restored", "removed", "unchanged", "conflict", "failed"]
    message: str
    current: Optional[FileVersionView] = None
    conflict_reason: Optional[Literal["modified", "missing", "appeared", "not_file", "modified_during_run"]] = None
    can_force: bool = False

    @classmethod
    def of(cls, outcome: UndoOutcome) -> "UndoItemResult":
        return cls(relative_path=outcome.relative_path, status=outcome.status, message=outcome.message,
                   current=FileVersionView.of(outcome.current), conflict_reason=outcome.conflict_reason,
                   can_force=outcome.can_force)


class UndoResponse(BaseModel):
    model_config = _STRICT

    results: list[UndoItemResult]


def run_summary_view(summary: RunSummary) -> RunSummaryView:
    return RunSummaryView(run_id=summary.run_id, session_id=summary.session_id, session_title=summary.session_title,
                          run_status=summary.run_status, changed_files=summary.changed_files,
                          first_at=to_epoch_ms(summary.first_at), last_at=to_epoch_ms(summary.last_at),
                          kind=summary.kind, undo_of_run_id=summary.undo_of_run_id)
