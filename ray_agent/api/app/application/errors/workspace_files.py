"""文件 IO 错误到结构化应用错误的转换：越界为 forbidden，根失联为 unavailable，版本或名称冲突带当前版本。"""
from app.application.errors.exceptions import AppException
from app.domain.external.workspace_files import WorkspaceFileError
from app.domain.models.error import ErrorCode


def app_error(error: WorkspaceFileError) -> AppException:
    details = dict(error.details)
    if error.current is not None:
        details["current"] = {"size": error.current.size, "modified_ns": error.current.modified_ns}
    retryable = False if error.code is ErrorCode.UNAVAILABLE else None  # 文件夹失联不会自行恢复
    return AppException(error.code, str(error), retryable=retryable, resource_version=error.resource_version,
                        details=details)
