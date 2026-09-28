"""工具结果整形：挂在工具管线执行后段，所有工具的结果写入记忆前都经过这里。

结果序列化后超过单条上限（或协议适配层截断过内容）时，完整内容写入沙箱文件，模型只收到首尾预览、总长度、
文件路径与分段读取提示；写文件失败时退回纯截断，并在结果中注明完整内容不可再读。
"""
import json
import logging
import re
from typing import Any, Awaitable, Callable, List, Optional

from app.domain.models.event import ToolResultShaping
from app.domain.models.tool_result import ToolResult
from app.domain.services.flows.tool_pipeline import ToolInvocation

logger = logging.getLogger(__name__)

# 沙箱内普通用户可写的目录；W7.3 调整执行身份时同步（见 W2 子计划交接）
OUTPUT_DIR = "/home/ubuntu/.rayagent/outputs"
HEAD_RATIO = 0.45  # 预览开头占单条上限的比例
TAIL_RATIO = 0.2  # 预览结尾占单条上限的比例
INLINE_STRING_CHARS = 200  # 渲染完整内容时，短于此长度且不含换行的字符串与键写在同一行

WriteOutputFn = Callable[[str, str], Awaitable[None]]  # (沙箱路径, 文本) -> None，失败抛异常


def output_path(call_id: str, output_dir: str = OUTPUT_DIR) -> str:
    safe = re.sub(r"[^A-Za-z0-9_.-]", "_", call_id or "call")[:120]
    return f"{output_dir}/{safe}.txt"


def _render(value: Any, path: str, lines: List[str]) -> None:
    if isinstance(value, dict) and value:
        for key, item in value.items():
            _render(item, f"{path}.{key}" if path else str(key), lines)
    elif isinstance(value, list) and value:
        for index, item in enumerate(value):
            _render(item, f"{path}[{index}]", lines)
    elif isinstance(value, str) and (len(value) > INLINE_STRING_CHARS or "\n" in value):
        # 长文本原样写出，保留换行，便于按行分段读取
        lines.append(f"{path}:")
        lines.append(value)
    else:
        lines.append(f"{path}: {json.dumps(value, ensure_ascii=False)}")


def render_full_text(result: ToolResult) -> str:
    """完整内容的文本形式：每个字段一行，长文本原样展开。协议结果用适配层截断前的内容替换 data。"""
    data = result.full_content if result.full_content is not None else result.data
    if hasattr(data, "model_dump"):
        data = data.model_dump(mode="json")
    lines: List[str] = [f"success: {json.dumps(result.success)}",
                        f"message: {json.dumps(result.message or '', ensure_ascii=False)}"]
    _render(data, "data", lines)
    return "\n".join(lines)


class ResultShaper:
    """执行后处理函数：``await shaper(invocation, result)`` 返回进入记忆的结果，并在 invocation 上留下整形元数据。"""

    def __init__(self, max_chars: int, write_output: Optional[WriteOutputFn] = None,
                 output_dir: str = OUTPUT_DIR) -> None:
        self.max_chars = max_chars
        self._write_output = write_output
        self._output_dir = output_dir

    async def __call__(self, invocation: ToolInvocation, result: ToolResult) -> ToolResult:
        serialized = result.model_dump_json()
        if len(serialized) <= self.max_chars and result.full_content is None:
            return result

        full_text = render_full_text(result)
        path: Optional[str] = None
        error: Optional[str] = None
        if self._write_output is None:
            error = "当前运行没有可写的沙箱"
        else:
            candidate = output_path(invocation.call_id, self._output_dir)
            try:
                await self._write_output(candidate, full_text)
                path = candidate
            except Exception as e:
                error = str(e) or type(e).__name__
                logger.warning(f"工具[{invocation.function_name}]完整结果写入 {candidate} 失败: {error}")

        preview = self._preview(result, full_text, path, error)
        invocation.shaping = ToolResultShaping(
            original_chars=len(full_text),
            preview_chars=len(preview.model_dump_json()),
            full_output_path=path,
            error=error,
        )
        return preview

    def _note(self, total: int, lines: int, path: Optional[str], error: Optional[str]) -> str:
        head = f"结果共 {total} 字符（{lines} 行），超过单条上限 {self.max_chars} 字符，这里只给出开头与结尾。"
        if path:
            segment = int(self.max_chars * 0.6)
            return (f"{head}完整内容已保存到沙箱文件 {path}，需要其余部分时用 read_file 按行分段读取"
                    f"（设置 start_line/end_line，每段不超过约 {segment} 字符），或用 Shell 的 grep、sed 定位。")
        return f"{head}完整内容写入沙箱失败（{error}），不可再读；需要完整结果时请缩小范围后重新调用。"

    def _preview(self, result: ToolResult, full_text: str, path: Optional[str], error: Optional[str]) -> ToolResult:
        lines = full_text.count("\n") + 1
        note = self._note(len(full_text), lines, path, error)
        head_chars = int(self.max_chars * HEAD_RATIO)
        tail_chars = int(self.max_chars * TAIL_RATIO)
        while True:
            preview = ToolResult(
                success=result.success,
                message=(result.message or "")[:500],
                data={
                    "truncated": True,
                    "total_chars": len(full_text),
                    "total_lines": lines,
                    "full_output_path": path,
                    "note": note,
                    "head": full_text[:head_chars],
                    "tail": full_text[-tail_chars:] if tail_chars else "",
                },
            )
            # 转义会让序列化长度大于预览字符数：逐步收缩，保证进入上下文的结果不超过上限
            if len(preview.model_dump_json()) <= self.max_chars or head_chars <= 200:
                return preview
            head_chars = int(head_chars * 0.8)
            tail_chars = int(tail_chars * 0.8)
