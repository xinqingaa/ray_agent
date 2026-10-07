"""一次工作单元里需要通知前端刷新的会话或项目。提交成功后才发布。"""
from typing import Set, Tuple

HINTS = "catalog_hints"
CatalogHint = Tuple[str, str]


def note(db_session, kind: str, item_id: str) -> None:
    if not item_id:
        return
    info = getattr(db_session, "info", None)
    if not isinstance(info, dict):
        return
    info.setdefault(HINTS, set()).add((kind, str(item_id)))


def take(db_session) -> Set[CatalogHint]:
    info = getattr(db_session, "info", None)
    if not isinstance(info, dict):
        return set()
    return info.pop(HINTS, set()) or set()
