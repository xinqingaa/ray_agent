"""独立可取消的文档解析 worker：完整结构块，不截断为预览窗口。

入口：`python -m app.infrastructure.external.document_parse.worker <path> <format> [out.json]`
stdout 一行 JSON：{status, format, blocks?, reason?, component_needed?}
"""
from __future__ import annotations

import csv
import io
import json
import re
import resource
import sys
from pathlib import Path

from app.domain.models.document_knowledge import DOCUMENT_PARSE_MAX_BYTES, DocumentFormat


def _limit_resources() -> None:
    try:
        resource.setrlimit(resource.RLIMIT_CPU, (60, 60))
    except (ValueError, resource.error):
        pass
    if sys.platform.startswith("linux"):
        try:
            resource.setrlimit(resource.RLIMIT_AS, (1536 * 1024 * 1024, 1536 * 1024 * 1024))
        except (ValueError, resource.error):
            pass


def emit(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def fail(reason: str, *, component: str | None = None) -> dict:
    payload = {"status": "failed", "reason": reason}
    if component:
        payload["status"] = "pending_component"
        payload["component_needed"] = component
    return payload


def block(kind: str, text: str, **locator) -> dict:
    return {"kind": kind, "text": text, "locator": locator}


def read_bytes(path: Path) -> bytes:
    data = path.read_bytes()
    if len(data) > DOCUMENT_PARSE_MAX_BYTES:
        raise ValueError(f"文件超过解析上限（{DOCUMENT_PARSE_MAX_BYTES} 字节）")
    return data


def decode_text(data: bytes) -> str:
    for encoding in ("utf-8-sig", "utf-8", "gb18030", "latin-1"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise ValueError("无法识别文本编码")


def parse_text(path: Path, fmt: str) -> dict:
    text = decode_text(read_bytes(path))
    lines = text.splitlines()
    blocks = []
    if fmt == DocumentFormat.MARKDOWN.value:
        buf: list[str] = []
        heading = None
        start_line = 1

        def flush():
            nonlocal buf, start_line
            body = "\n".join(buf).strip()
            if body:
                blocks.append(block("text", body, heading=heading, line_start=start_line,
                                    line_end=start_line + len(buf) - 1))
            buf = []

        for index, line in enumerate(lines, start=1):
            if line.startswith("#"):
                flush()
                heading = line.lstrip("#").strip() or line
                start_line = index
                buf = [line]
            else:
                if not buf:
                    start_line = index
                buf.append(line)
        flush()
    else:
        # 按空行分段，保留行号
        buf, start_line = [], 1
        for index, line in enumerate(lines, start=1):
            if not line.strip() and buf:
                body = "\n".join(buf)
                blocks.append(block("text", body, line_start=start_line, line_end=index - 1))
                buf, start_line = [], index + 1
            else:
                if not buf:
                    start_line = index
                buf.append(line)
        if buf:
            blocks.append(block("text", "\n".join(buf), line_start=start_line, line_end=start_line + len(buf) - 1))
    if not blocks and text.strip():
        blocks.append(block("text", text, line_start=1, line_end=len(lines) or 1))
    return {"status": "ok", "format": fmt, "blocks": blocks}


def parse_html(path: Path) -> dict:
    from bs4 import BeautifulSoup
    raw = decode_text(read_bytes(path))
    soup = BeautifulSoup(raw, "html.parser")
    for tag in soup(["script", "style", "noscript"]):
        tag.decompose()
    title = (soup.title.string or "").strip() if soup.title else ""
    text = soup.get_text("\n", strip=True)
    blocks = []
    if title:
        blocks.append(block("heading", title, heading=title))
    if text:
        blocks.append(block("text", text, heading=title or None))
    return {"status": "ok", "format": DocumentFormat.HTML.value, "blocks": blocks}


def parse_pdf(path: Path) -> dict:
    try:
        from pypdf import PdfReader
    except ImportError:
        return fail("缺少 pypdf", component=None)
    reader = PdfReader(str(path))
    if getattr(reader, "is_encrypted", False):
        return fail("加密 PDF 不支持解析")
    blocks = []
    pages_with_text = 0
    for index, page in enumerate(reader.pages, start=1):
        try:
            text = page.extract_text() or ""
        except Exception as error:  # noqa: BLE001 — 单页失败不阻断整份
            text = ""
            blocks.append(block("text", f"[第 {index} 页提取失败：{error}]", page=index))
            continue
        text = text.strip()
        if text:
            pages_with_text += 1
            blocks.append(block("text", text, page=index))
    if not pages_with_text:
        # 扫描件：本包标待 OCR，不阻塞其他材料
        return fail("PDF 无可提取文本层，待 OCR 组件", component="ocr")
    return {"status": "ok", "format": DocumentFormat.PDF.value, "blocks": blocks}


def parse_docx(path: Path) -> dict:
    from docx import Document
    doc = Document(str(path))
    blocks = []
    for index, paragraph in enumerate(doc.paragraphs):
        text = (paragraph.text or "").strip()
        if not text:
            continue
        style = getattr(paragraph.style, "name", "") or ""
        kind = "heading" if style.lower().startswith("heading") else "text"
        blocks.append(block(kind, text, block=index, heading=text if kind == "heading" else None))
    for t_index, table in enumerate(doc.tables):
        rows = []
        for row in table.rows:
            rows.append("\t".join((cell.text or "").strip() for cell in row.cells))
        if not rows:
            continue
        header = rows[0]
        blocks.append(block("table", "\n".join(rows), table=t_index, header=header))
    return {"status": "ok", "format": DocumentFormat.DOCX.value, "blocks": blocks}


def parse_pptx(path: Path) -> dict:
    from pptx import Presentation
    prs = Presentation(str(path))
    blocks = []
    for s_index, slide in enumerate(prs.slides, start=1):
        texts = []
        for shape in slide.shapes:
            if getattr(shape, "has_text_frame", False):
                for paragraph in shape.text_frame.paragraphs:
                    line = "".join(run.text for run in paragraph.runs).strip()
                    if line:
                        texts.append(line)
            if getattr(shape, "has_table", False):
                rows = []
                for row in shape.table.rows:
                    rows.append("\t".join(cell.text.strip() for cell in row.cells))
                if rows:
                    blocks.append(block("table", "\n".join(rows), slide=s_index, header=rows[0]))
        if texts:
            blocks.append(block("text", "\n".join(texts), slide=s_index))
    return {"status": "ok", "format": DocumentFormat.PPTX.value, "blocks": blocks}


def parse_xlsx(path: Path) -> dict:
    from openpyxl import load_workbook
    wb = load_workbook(str(path), read_only=True, data_only=True)
    blocks = []
    try:
        for sheet in wb.worksheets:
            rows = []
            for row in sheet.iter_rows(values_only=True):
                values = [("" if cell is None else str(cell)) for cell in row]
                if any(v.strip() for v in values):
                    rows.append("\t".join(values))
            if rows:
                blocks.append(block("table", "\n".join(rows), sheet=sheet.title, header=rows[0]))
    finally:
        wb.close()
    return {"status": "ok", "format": DocumentFormat.XLSX.value, "blocks": blocks}


def parse_delimited(path: Path, fmt: str) -> dict:
    text = decode_text(read_bytes(path))
    delimiter = "\t" if fmt == DocumentFormat.TSV.value else ","
    reader = csv.reader(io.StringIO(text), delimiter=delimiter)
    rows = ["\t".join(row) for row in reader]
    if not rows:
        return {"status": "ok", "format": fmt, "blocks": []}
    return {"status": "ok", "format": fmt, "blocks": [block("table", "\n".join(rows), header=rows[0])]}


def parse_image(_path: Path) -> dict:
    return fail("图片需 OCR 组件识别", component="ocr")


PARSERS = {
    DocumentFormat.TEXT.value: lambda p: parse_text(p, DocumentFormat.TEXT.value),
    DocumentFormat.MARKDOWN.value: lambda p: parse_text(p, DocumentFormat.MARKDOWN.value),
    DocumentFormat.CODE.value: lambda p: parse_text(p, DocumentFormat.CODE.value),
    DocumentFormat.JSON.value: lambda p: parse_text(p, DocumentFormat.JSON.value),
    DocumentFormat.HTML.value: parse_html,
    DocumentFormat.PDF.value: parse_pdf,
    DocumentFormat.DOCX.value: parse_docx,
    DocumentFormat.PPTX.value: parse_pptx,
    DocumentFormat.XLSX.value: parse_xlsx,
    DocumentFormat.CSV.value: lambda p: parse_delimited(p, DocumentFormat.CSV.value),
    DocumentFormat.TSV.value: lambda p: parse_delimited(p, DocumentFormat.TSV.value),
    DocumentFormat.IMAGE.value: parse_image,
}


def parse(path: str, fmt: str) -> dict:
    target = Path(path)
    if not target.is_file():
        return fail("文件不存在")
    if fmt == DocumentFormat.UNSUPPORTED.value or fmt not in PARSERS:
        return fail(f"不支持的格式：{fmt}")
    try:
        return PARSERS[fmt](target)
    except Exception as error:  # noqa: BLE001 — worker 边界：一律结构化失败
        return fail(str(error) or type(error).__name__)


def main(argv: list[str] | None = None) -> int:
    _limit_resources()
    args = list(sys.argv[1:] if argv is None else argv)
    if len(args) < 2:
        emit(fail("用法：worker <path> <format> [out.json]"))
        return 2
    path, fmt = args[0], args[1]
    out = args[2] if len(args) > 2 else None
    result = parse(path, fmt)
    if out:
        Path(out).write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
    emit(result)
    return 0 if result.get("status") == "ok" else 1


if __name__ == "__main__":
    raise SystemExit(main())
