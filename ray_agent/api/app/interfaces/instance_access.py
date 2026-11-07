"""实例访问控制：启用实例令牌后，/api 下的请求必须带 `Authorization: Bearer <令牌>`。

图片、PDF 与网页预览由浏览器按 URL 直接加载，无法附带请求头；这类读取改用短期票据。票据只放行签发时的那条路径的
GET 与 HEAD，到期作废，可在有效期内重复使用。令牌不进 URL，票据只存在本进程内存。
"""
import hmac
import secrets
import time
from collections import OrderedDict
from typing import Optional
from urllib.parse import parse_qs

from app.domain.models.error import ErrorCode, ErrorInfo
from app.interfaces.errors.exception_handlers import error_response

TICKET_PARAM = "ticket"
_READ_METHODS = frozenset({"GET", "HEAD"})

_token: Optional[str] = None
_tickets: "OrderedDict[str, tuple[str, float]]" = OrderedDict()


def enable_instance_token() -> str:
    """生成本进程的实例令牌；之后所有 /api 请求都要出示它。"""
    global _token
    _token = secrets.token_urlsafe(32)
    _tickets.clear()
    return _token


def disable_instance_token() -> None:
    global _token
    _token = None
    _tickets.clear()


def issue_ticket(path: str) -> tuple[str, int]:
    """为一条资源路径签发票据，返回票据与到期时间（毫秒时间戳）。"""
    from core.config import get_settings
    settings = get_settings()
    now = time.monotonic()
    for key, (_, expires) in list(_tickets.items()):
        if expires <= now:
            del _tickets[key]
    while len(_tickets) >= settings.resource_ticket_capacity:
        _tickets.popitem(last=False)
    ticket = secrets.token_urlsafe(24)
    _tickets[ticket] = (path, now + settings.resource_ticket_seconds)
    return ticket, int((time.time() + settings.resource_ticket_seconds) * 1000)


def _ticket_allows(ticket: str, path: str, method: str) -> bool:
    entry = _tickets.get(ticket)
    if entry is None or method not in _READ_METHODS:
        return False
    allowed, expires = entry
    if expires <= time.monotonic():
        del _tickets[ticket]
        return False
    return hmac.compare_digest(allowed, path)


def _bearer(scope) -> Optional[str]:
    for name, value in scope.get("headers") or ():
        if name == b"authorization":
            scheme, _, credential = value.decode("latin-1").partition(" ")
            return credential.strip() if scheme.lower() == "bearer" else None
    return None


class InstanceAccessMiddleware:
    """纯 ASGI 中间件，不包装响应体，SSE 与流式下载的取消语义保持原样。CORS 预检放行，由外层 CORS 中间件应答。"""

    def __init__(self, app) -> None:
        self.app = app

    async def __call__(self, scope, receive, send):
        token = _token
        if (token is None or scope["type"] != "http" or scope.get("method") == "OPTIONS"
                or not scope["path"].startswith("/api/")):
            return await self.app(scope, receive, send)
        presented = _bearer(scope)
        if presented is not None and hmac.compare_digest(presented, token):
            return await self.app(scope, receive, send)
        tickets = parse_qs(scope.get("query_string", b"").decode("latin-1")).get(TICKET_PARAM)
        if tickets and _ticket_allows(tickets[0], scope["path"], scope["method"]):
            return await self.app(scope, receive, send)
        response = error_response(ErrorInfo.of(ErrorCode.UNAUTHORIZED, "缺少或无效的实例令牌"))
        await response(scope, receive, send)
