"""工作区、文件夹授权与根内文件接口的契约；时间为毫秒时间戳，文件位置一律是 root_id 加相对路径。"""
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

from app.domain.external.workspace_files import FileEntry, FileKind, ScanSummary
from app.domain.models.identity import RootedPath
from app.domain.models.workspace import ConflictResolution, FolderStatus, MarkerConflict, WorkspaceStatus
from app.interfaces.schemas.event import to_epoch_ms
from app.interfaces.schemas.workspace_changes import WriteLeaseView

_STRICT = ConfigDict(json_schema_serialization_defaults_required=True)


class FolderGrantRequest(BaseModel):
    path: str = Field(min_length=1, description="宿主在系统选择器里选中的文件夹绝对路径")


class ResolveRootPathRequest(BaseModel):
    relative_path: str = Field(default="", max_length=4096, description="根内相对路径；空表示根目录本身")


class ResolveRootPathResponse(BaseModel):
    model_config = _STRICT

    path: str = Field(description="目标在本机的绝对路径，只供宿主在文件管理器中显示位置")


class FolderGrantResponse(BaseModel):
    model_config = _STRICT

    grant_id: str = Field(description="一次性、短期有效的凭证；界面用它打开工作区或更改默认位置")
    path: str
    expires_at: int = Field(description="毫秒时间戳")


class FolderView(BaseModel):
    model_config = _STRICT

    root_id: str = Field(description="文件接口使用的可访问根")
    path: str = Field(description="绑定的文件夹位置，用于展示与打开位置")
    status: FolderStatus
    marker_writable: bool = Field(description="身份标记写入失败为假：移动文件夹后需要手动重新选择")
    checked_at: Optional[int] = None


class WorkspaceItem(BaseModel):
    model_config = _STRICT

    id: str
    name: str
    status: WorkspaceStatus
    version: int = Field(description="重命名、归档等修改时回传，用于并发修改核对")
    folder: Optional[FolderView] = None
    write_lease: Optional[WriteLeaseView] = Field(default=None, description="文件夹当前的写入租约；为空表示没有写入者")
    created_at: int
    updated_at: int


class WorkspaceListResponse(BaseModel):
    model_config = _STRICT

    workspaces: list[WorkspaceItem]


class CreateWorkspaceRequest(BaseModel):
    name: str = Field(min_length=1, max_length=200, description="工作区名称，同时是默认位置下新建文件夹的名称")


class OpenWorkspaceRequest(BaseModel):
    grant_id: str
    name: Optional[str] = Field(default=None, max_length=200, description="新工作区的名称；省略时用文件夹名")


class OpenWorkspaceResult(BaseModel):
    """status=opened：workspace 为打开的工作区，recognized 说明是新工作区、已有工作区，还是识别出移动并改绑；
    status=conflict：文件夹是复制出来的，调用 resolve 带 conflict.conflict_id 选择作为新工作区或改绑到这里。"""
    model_config = _STRICT

    status: Literal["opened", "conflict"]
    workspace: Optional[WorkspaceItem] = None
    scan: Optional[ScanSummary] = None
    recognized: Optional[Literal["new", "existing", "moved"]] = None
    conflict: Optional[MarkerConflict] = None


class ResolveConflictRequest(BaseModel):
    conflict_id: str
    resolution: ConflictResolution


class RenameWorkspaceRequest(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    version: int = Field(ge=1)


class RelocateWorkspaceRequest(BaseModel):
    grant_id: str
    version: int = Field(ge=1)


class WorkspaceVersionRequest(BaseModel):
    version: int = Field(ge=1)


class DefaultLocationResponse(BaseModel):
    model_config = _STRICT

    path: str


class DefaultLocationRequest(BaseModel):
    grant_id: str


class RootEntryView(BaseModel):
    model_config = _STRICT

    path: RootedPath
    name: str
    kind: FileKind
    size: Optional[int] = None
    modified_at: Optional[int] = Field(default=None, description="毫秒时间戳；只有普通文件有")
    link_target: Optional[str] = Field(default=None, description="符号链接的目标文本；链接不被展开或跟随")

    @classmethod
    def of(cls, entry: FileEntry) -> "RootEntryView":
        version = entry.version
        return cls(path=entry.path, name=entry.name, kind=entry.kind, size=version.size if version else None,
                   modified_at=version.modified_ns // 1_000_000 if version else None, link_target=entry.link_target)


class RootListing(BaseModel):
    model_config = _STRICT

    path: RootedPath
    entries: list[RootEntryView]
    truncated: bool = False


class RootEntryResponse(BaseModel):
    model_config = _STRICT

    entry: RootEntryView


def workspace_item(view) -> WorkspaceItem:
    folder = view.folder
    return WorkspaceItem(
        id=view.workspace.id, name=view.workspace.name, status=view.workspace.status,
        version=view.workspace.version, created_at=to_epoch_ms(view.workspace.created_at),
        updated_at=to_epoch_ms(view.workspace.updated_at),
        folder=FolderView(root_id=folder.ref.root_id, path=folder.location, status=folder.status,
                          marker_writable=folder.marker_writable,
                          checked_at=to_epoch_ms(folder.checked_at) if folder.checked_at else None)
        if folder is not None else None,
        write_lease=WriteLeaseView.of(view.lease) if getattr(view, "lease", None) is not None else None)
