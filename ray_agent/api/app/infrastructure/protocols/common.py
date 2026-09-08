"""协议结果和发现状态；错误展示不泄漏 URL、请求头或子进程环境。"""
import asyncio
from typing import Any

from app.domain.models.tool_result import ToolResult


def failure(kind: str, message: str, **data: Any) -> ToolResult:
    return ToolResult(success=False, message=message, data={"error_kind": kind, **data})


def describe_content(value: Any) -> Any:
    """保留 JSON 空值；二进制仅保留长度，长文本与列表显式标注截断。"""
    if isinstance(value, dict):
        return {k: ({"omitted": True, "encoded_length": len(v)}
                    if k in {"raw", "blob"} and isinstance(v, str)
                    or k == "data" and value.get("type") in {"image", "audio"} and isinstance(v, str)
                    else describe_content(v)) for k, v in value.items()}
    if isinstance(value, list):
        result = [describe_content(item) for item in value[:100]]
        if len(value) > 100:
            result.append({"omitted_items": len(value) - 100})
        return result
    if isinstance(value, str) and len(value) > 16000:
        return value[:16000] + f"\n[截断，原长度 {len(value)}]"
    return value


async def discover_all(jobs: dict[str, Any], budget: float, errors: dict[str, str]) -> None:
    """并行发现，共用总预算；未完成项仍保留在产品配置列表。"""
    tasks = {key: asyncio.create_task(job, name=f"protocol-discover:{key}") for key, job in jobs.items()}
    if not tasks:
        return
    try:
        _, pending = await asyncio.wait(tasks.values(), timeout=budget)
        for key, task in tasks.items():
            if task in pending:
                errors[key] = "发现超出整体时间预算"
                task.cancel()
        await asyncio.gather(*tasks.values(), return_exceptions=True)
    except asyncio.CancelledError:
        for task in tasks.values():
            task.cancel()
        await asyncio.gather(*tasks.values(), return_exceptions=True)
        # 内部预算取消不能取消整个设置请求。
        if asyncio.current_task().cancelling():
            raise
