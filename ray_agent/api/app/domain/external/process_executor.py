"""进程执行端口：按运行或操作登记进程，停止与强制结束都作用于整棵进程树。

命令要么是直接执行的参数列表，要么交给平台系统 Shell；Shell 方言由执行端报告，不假设是 bash。
环境在受控基础环境上追加，不继承核心进程的完整环境。
"""
from datetime import datetime
from enum import StrEnum
from typing import Annotated, Literal, Protocol, Self

from pydantic import BaseModel, Field, StringConstraints, model_validator

from app.domain.models.identity import ID_MAX_LENGTH, OperationId, RootedPath, RunId, SessionId

type ProcessId = Annotated[str, StringConstraints(min_length=1, max_length=ID_MAX_LENGTH),
                           Field(description="执行端分配的进程身份，不是操作系统 PID")]


class ShellDialect(StrEnum):
    POSIX = "posix"
    POWERSHELL = "powershell"


class ShellInfo(BaseModel):
    dialect: ShellDialect
    program: str  # 展示用的 Shell 名称或路径


class ProcessOwner(BaseModel):
    session_id: SessionId | None = None
    run_id: RunId | None = None
    operation_id: OperationId | None = None

    @model_validator(mode="after")
    def _has_owner(self) -> Self:
        if not (self.run_id or self.operation_id):
            raise ValueError("进程必须归属于运行或操作")
        return self


class ProcessSpec(BaseModel):
    argv: list[str] | None = None
    shell_command: str | None = None
    cwd: RootedPath
    env: dict[str, str] = Field(default_factory=dict)
    owner: ProcessOwner
    interactive: bool = False  # 是否保留标准输入供后续写入

    @model_validator(mode="after")
    def _one_command(self) -> Self:
        if (self.argv is None) == (self.shell_command is None):
            raise ValueError("argv 与 shell_command 必须且只能给出一个")
        if self.argv is not None and not self.argv:
            raise ValueError("argv 不能为空")
        return self


class ProcessState(StrEnum):
    RUNNING = "running"
    EXITED = "exited"  # 自行结束
    STOPPED = "stopped"  # 经 stop_tree 收尾
    KILLED = "killed"  # 经 kill_tree 强制结束
    LOST = "lost"  # 执行端失联，结果无法确认，保留阻止标记


class ProcessStatus(BaseModel):
    process_id: ProcessId
    state: ProcessState
    exit_code: int | None = None
    started_at: datetime
    ended_at: datetime | None = None


class ProcessOutput(BaseModel):
    process_id: ProcessId
    stream: Literal["combined"] = "combined"
    text: str
    next_offset: int = Field(ge=0)
    truncated: bool = False  # 超出保留上限的早期输出已丢弃


class ProcessExecutor(Protocol):
    async def shell_info(self) -> ShellInfo:
        ...

    async def start(self, spec: ProcessSpec) -> ProcessStatus:
        ...

    async def status(self, process_id: ProcessId) -> ProcessStatus:
        ...

    async def read_output(self, process_id: ProcessId, offset: int = 0) -> ProcessOutput:
        ...

    async def write_input(self, process_id: ProcessId, text: str) -> None:
        ...

    async def wait(self, process_id: ProcessId, timeout_seconds: float | None = None) -> ProcessStatus:
        ...

    async def stop_tree(self, process_id: ProcessId, grace_seconds: float) -> ProcessStatus:
        """请平台以正常方式终止整棵进程树；期限内未退出则保持 running 返回，由调用方决定是否强制结束。"""
        ...

    async def kill_tree(self, process_id: ProcessId) -> ProcessStatus:
        """强制结束整棵进程树；无法确认时返回 lost。"""
        ...
