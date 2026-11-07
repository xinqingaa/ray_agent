"""宿主身份：只有宿主进程知道的密钥。

宿主经启动参数把密钥交给核心；界面只有实例令牌，没有这个密钥，因此不能自行登记桌面路径。
密钥只保存在进程内，不写入环境变量，避免被核心拉起的子进程继承。
"""
import hmac
from typing import Optional

from fastapi import Request

from app.application.errors.exceptions import AppException
from app.domain.models.error import ErrorCode

HOST_SECRET_HEADER = "X-RayAgent-Host-Secret"

_secret: Optional[str] = None


def set_host_secret(secret: Optional[str]) -> None:
    global _secret
    _secret = secret


def require_host(request: Request) -> None:
    supplied = request.headers.get(HOST_SECRET_HEADER, "")
    if not _secret or not hmac.compare_digest(supplied.encode(), _secret.encode()):
        raise AppException(ErrorCode.FORBIDDEN, "该接口只供桌面宿主调用")
