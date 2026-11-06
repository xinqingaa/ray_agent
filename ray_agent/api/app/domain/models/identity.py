"""跨模块共用的身份类型。

身份由服务端生成，是不透明字符串；名称、文件夹路径、角色或窗口都不能推导身份。版本是正整数或内容哈希。
相对路径只描述可访问根内的位置：以 `/` 分隔，不是任何平台的绝对路径，平台特有的文件名限制由文件 IO 实现判断。
"""
import re
from enum import StrEnum
from typing import Annotated, Self

from pydantic import AfterValidator, BaseModel, Field, StringConstraints, model_validator

ID_MAX_LENGTH = 128
RELATIVE_PATH_MAX_LENGTH = 4096

_ID = StringConstraints(min_length=1, max_length=ID_MAX_LENGTH, pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]*$")

type WorkspaceId = Annotated[str, _ID, Field(description="工作区身份；独立对话没有工作区")]
type InstallId = Annotated[str, _ID, Field(description="本机安装身份，用于文件夹标记与实例发现，不是用户账号")]
type RootId = Annotated[str, _ID, Field(description="可访问根：工作区文件夹或会话工作目录")]
type SessionId = Annotated[str, _ID, Field(description="会话身份")]
type RunId = Annotated[str, _ID, Field(description="运行身份；一个会话至多一个活动运行")]
type DocumentId = Annotated[str, _ID, Field(description="文档身份；移动不强制变更")]
type MemoryId = Annotated[str, _ID, Field(description="记忆条目身份")]
type SkillId = Annotated[str, _ID, Field(description="Skill 来源身份；同名不同来源是不同身份")]
type OperationId = Annotated[str, _ID, Field(description="长操作身份；查询、取消与重试沿同一身份")]
type RequestId = Annotated[str, _ID, Field(description="业务幂等请求身份；同身份不同内容返回冲突")]
type InstanceId = Annotated[str, _ID, Field(description="核心进程的一次启动")]
type BackgroundJobId = Annotated[str, _ID, Field(description="持久后台任务身份")]

type InstructionVersion = Annotated[int, Field(ge=1, description="工作方式的不可变版本，工作区内递增")]
type DocumentRevision = Annotated[int, Field(ge=1, description="文档内容版本；内容变化产生新版本")]
type MemoryVersion = Annotated[int, Field(ge=1, description="记忆条目版本")]
type Generation = Annotated[int, Field(ge=1, description="代次：对象被重试或替换时递增，迟到结果代次不符时不得写回")]
type ContentHash = Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{64}$"),
                             Field(description="内容的 SHA-256 十六进制摘要")]

_DRIVE = re.compile(r"^[A-Za-z]:")


def validate_relative_path(value: str) -> str:
    """空串表示根本身。拒绝绝对路径、盘符、反斜杠、空段、`.`、`..` 与控制字符。"""
    if value == "":
        return value
    if "\\" in value:
        raise ValueError("相对路径只用 / 分隔")
    if value.startswith("/") or _DRIVE.match(value):
        raise ValueError("相对路径不能是绝对路径或带盘符")
    for part in value.split("/"):
        if part in ("", ".", ".."):
            raise ValueError("相对路径不能包含空段、. 或 ..")
        if any(ord(char) < 32 or ord(char) == 127 for char in part):
            raise ValueError("相对路径不能包含控制字符")
    return value


type RelativePath = Annotated[
    str,
    StringConstraints(max_length=RELATIVE_PATH_MAX_LENGTH),
    AfterValidator(validate_relative_path),
    Field(description="根内相对路径：以 / 分隔，空串表示根本身；不含绝对路径、盘符、反斜杠、空段、. 与 ..，不含控制字符"),
]


def relative_parts(path: RelativePath) -> tuple[str, ...]:
    return tuple(path.split("/")) if path else ()


class RootKind(StrEnum):
    WORKSPACE_FOLDER = "workspace_folder"  # 工作区绑定的本地文件夹
    SESSION_WORKDIR = "session_workdir"  # 会话在应用数据目录中的工作目录


class RootRef(BaseModel):
    """登记的可访问根。工作区文件夹属于工作区，会话工作目录属于会话。"""
    root_id: RootId
    kind: RootKind
    workspace_id: WorkspaceId | None = None
    session_id: SessionId | None = None

    @model_validator(mode="after")
    def _owner_matches_kind(self) -> Self:
        if self.kind is RootKind.WORKSPACE_FOLDER and (self.workspace_id is None or self.session_id is not None):
            raise ValueError("工作区文件夹根只属于工作区")
        if self.kind is RootKind.SESSION_WORKDIR and self.session_id is None:
            raise ValueError("会话工作目录根必须属于会话")
        return self


class RootedPath(BaseModel):
    """文件接口与执行端口使用的位置；客户端不提交桌面绝对路径。"""
    root_id: RootId
    relative_path: RelativePath = ""


class InstructionRef(BaseModel):
    workspace_id: WorkspaceId
    version: InstructionVersion


class DocumentRef(BaseModel):
    document_id: DocumentId
    revision: DocumentRevision


class MemoryRef(BaseModel):
    memory_id: MemoryId
    version: MemoryVersion


class SkillRef(BaseModel):
    skill_id: SkillId
    content_hash: ContentHash


class JobRef(BaseModel):
    """后台任务身份与代次；执行结果写回前核对代次。"""
    job_id: BackgroundJobId
    generation: Generation
