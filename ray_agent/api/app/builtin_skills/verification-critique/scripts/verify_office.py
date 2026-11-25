#!/usr/bin/env python3
"""纯 CPython 3.12 标准库实现的交付产物确定性核验脚本。

用法：python3 verify_office.py <filepath> [--json]
输出标准 JSON，兼容 RayAgent verification 协议：
  {"passed": bool, "format": str, "summary": str, "metrics": dict, "warnings": list, "issues": list}
"""
from __future__ import annotations

import argparse
import html.parser
import json
import re
import sys
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

_PLACEHOLDER_RE = re.compile(r"(\{\{[^}]+\}\}|\bTODO\b|\bTBD\b|FIXME)", re.IGNORECASE)
_NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
_NS_DRAW = "http://schemas.openxmlformats.org/drawingml/2006/main"
_NS_WORD = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"


class _HtmlScanner(html.parser.HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.has_charset = False
        self.text_chunks: list[str] = []
        self.local_refs: list[str] = []
        self._in_ignored = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attr_map = {k.lower(): (v or "") for k, v in attrs}
        lower = tag.lower()
        if lower == "meta" and (
            "charset" in attr_map
            or ("http-equiv" in attr_map and "content-type" in attr_map["http-equiv"].lower() and "utf-8" in attr_map.get("content", "").lower())
        ):
            self.has_charset = True
        if lower in ("script", "style"):
            self._in_ignored += 1
        for key in ("src", "href"):
            val = attr_map.get(key, "").strip()
            if val and not val.startswith(("http://", "https://", "data:", "blob:", "mailto:", "tel:", "#", "javascript:")):
                self.local_refs.append(val)

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() in ("script", "style") and self._in_ignored > 0:
            self._in_ignored -= 1

    def handle_data(self, data: str) -> None:
        if self._in_ignored == 0 and data.strip():
            self.text_chunks.append(data.strip())


def _result(fmt: str, passed: bool, summary: str, *, metrics: dict | None = None,
            warnings: list[str] | None = None, issues: list[str] | None = None) -> dict:
    return {
        "passed": passed,
        "format": fmt,
        "summary": summary,
        "metrics": metrics or {},
        "warnings": warnings or [],
        "issues": issues or [],
    }


def verify_xlsx(path: Path) -> dict:
    issues: list[str] = []
    warnings: list[str] = []
    try:
        with zipfile.ZipFile(path) as zf:
            names = set(zf.namelist())
            if "xl/workbook.xml" not in names:
                return _result("xlsx", False, "无效的 .xlsx：缺少 xl/workbook.xml", issues=["缺少 xl/workbook.xml"])
            wb_root = ET.fromstring(zf.read("xl/workbook.xml"))
            sheet_names = [
                el.attrib.get("name", "")
                for el in wb_root.findall(f".//{{{_NS_MAIN}}}sheet")
            ]
            sheet_files = sorted(n for n in names if n.startswith("xl/worksheets/sheet") and n.endswith(".xml"))
            if not sheet_files:
                return _result("xlsx", False, "工作簿中没有工作表 XML", issues=["缺少工作表 XML"])
            non_empty_rows = 0
            formula_cells = 0
            uncached_formulas = 0
            for sf in sheet_files:
                root = ET.fromstring(zf.read(sf))
                for row in root.findall(f".//{{{_NS_MAIN}}}row"):
                    cells = row.findall(f"{{{_NS_MAIN}}}c")
                    row_has_content = False
                    for cell in cells:
                        f_el = cell.find(f"{{{_NS_MAIN}}}f")
                        v_el = cell.find(f"{{{_NS_MAIN}}}v")
                        is_el = cell.find(f"{{{_NS_MAIN}}}is")
                        val_text = (v_el.text or "").strip() if v_el is not None else ""
                        if f_el is not None:
                            row_has_content = True
                            formula_cells += 1
                            if not val_text:
                                uncached_formulas += 1
                        elif val_text or (is_el is not None and "".join(is_el.itertext()).strip()):
                            row_has_content = True
                    if row_has_content:
                        non_empty_rows += 1
    except (zipfile.BadZipFile, ET.ParseError) as exc:
        return _result("xlsx", False, f".xlsx 文件损坏或 XML 解析失败: {exc}", issues=[str(exc)])

    if non_empty_rows == 0:
        issues.append("工作簿所有工作表均为空")
    if uncached_formulas > 0:
        warnings.append(
            f"检测到 {uncached_formulas} 个公式单元格缺少缓存值（预览器不重算公式），请在答复中提供代码核算后的关键汇总值"
        )
    passed = len(issues) == 0
    summary = (
        f"工作表 {len(sheet_files)} 个（{', '.join(sheet_names) or '未命名'}），"
        f"非空行 {non_empty_rows} 行，公式 {formula_cells} 个（未缓存 {uncached_formulas} 个）"
    )
    return _result(
        "xlsx", passed, summary,
        metrics={
            "sheets": len(sheet_files),
            "sheet_names": sheet_names,
            "non_empty_rows": non_empty_rows,
            "formula_cells": formula_cells,
            "uncached_formulas": uncached_formulas,
        },
        warnings=warnings, issues=issues,
    )


def verify_pptx(path: Path) -> dict:
    issues: list[str] = []
    warnings: list[str] = []
    try:
        with zipfile.ZipFile(path) as zf:
            names = set(zf.namelist())
            if "ppt/presentation.xml" not in names:
                return _result("pptx", False, "无效的 .pptx：缺少 ppt/presentation.xml", issues=["缺少 ppt/presentation.xml"])
            slide_files = sorted(
                (n for n in names if re.fullmatch(r"ppt/slides/slide\d+\.xml", n)),
                key=lambda s: int(re.search(r"(\d+)", s).group(1)),
            )
            if not slide_files:
                return _result("pptx", False, "演示文稿不包含任何幻灯片", issues=["幻灯片数为 0"])
            empty_slides: list[int] = []
            total_chars = 0
            bad_chars = 0
            for idx, sf in enumerate(slide_files, start=1):
                root = ET.fromstring(zf.read(sf))
                texts = [(el.text or "").strip() for el in root.findall(f".//{{{_NS_DRAW}}}t")]
                joined = "".join(texts).strip()
                total_chars += len(joined)
                bad_chars += joined.count("\ufffd")
                if not joined:
                    empty_slides.append(idx)
    except (zipfile.BadZipFile, ET.ParseError) as exc:
        return _result("pptx", False, f".pptx 文件损坏或 XML 解析失败: {exc}", issues=[str(exc)])

    if empty_slides:
        warnings.append(f"第 {empty_slides} 页未检测到可提取文字（可能为空页或纯图片页）")
    if bad_chars > 0:
        issues.append(f"检测到 {bad_chars} 个替换字符 U+FFFD，可能存在编码/字体异常")
    if total_chars == 0:
        issues.append("所有幻灯片均无文本内容")
    passed = len(issues) == 0
    summary = f"共 {len(slide_files)} 页幻灯片，提取文本 {total_chars} 字符"
    return _result(
        "pptx", passed, summary,
        metrics={"slides": len(slide_files), "total_chars": total_chars, "empty_slides": empty_slides},
        warnings=warnings, issues=issues,
    )


def verify_docx(path: Path) -> dict:
    issues: list[str] = []
    warnings: list[str] = []
    try:
        with zipfile.ZipFile(path) as zf:
            names = set(zf.namelist())
            if "word/document.xml" not in names:
                return _result("docx", False, "无效的 .docx：缺少 word/document.xml", issues=["缺少 word/document.xml"])
            root = ET.fromstring(zf.read("word/document.xml"))
            paragraphs = root.findall(f".//{{{_NS_WORD}}}p")
            tables = root.findall(f".//{{{_NS_WORD}}}tbl")
            texts = [el.text or "" for el in root.findall(f".//{{{_NS_WORD}}}t")]
            joined = "".join(texts).strip()
    except (zipfile.BadZipFile, ET.ParseError) as exc:
        return _result("docx", False, f".docx 文件损坏或 XML 解析失败: {exc}", issues=[str(exc)])

    if not joined:
        issues.append("Word 文档正文中未提取到文本")
    if "\ufffd" in joined:
        issues.append("检测到异常替换字符 U+FFFD")
    if _PLACEHOLDER_RE.search(joined):
        warnings.append("文档正文含 TODO / TBD / {{...}} 等占位符，请确认是否已标明待确认")
    passed = len(issues) == 0
    summary = f"段落 {len(paragraphs)} 个，表格 {len(tables)} 个，正文 {len(joined)} 字符"
    return _result(
        "docx", passed, summary,
        metrics={"paragraphs": len(paragraphs), "tables": len(tables), "total_chars": len(joined)},
        warnings=warnings, issues=issues,
    )


def verify_html(path: Path) -> dict:
    issues: list[str] = []
    warnings: list[str] = []
    try:
        raw = path.read_text(encoding="utf-8")
    except UnicodeDecodeError as exc:
        return _result("html", False, f"HTML 不是有效的 UTF-8 编码: {exc}", issues=["非 UTF-8 编码"])
    scanner = _HtmlScanner()
    scanner.feed(raw)
    body_text = " ".join(scanner.text_chunks)
    if not scanner.has_charset:
        warnings.append("建议显式声明 <meta charset=\"utf-8\">，避免部分阅读器中文乱码")
    if not body_text:
        issues.append("HTML 页面未检测到可见文本内容")
    missing_refs = []
    for ref in scanner.local_refs:
        clean = ref.split("?", 1)[0].split("#", 1)[0]
        if clean and not (path.parent / clean).exists():
            missing_refs.append(ref)
    if missing_refs:
        issues.append(f"缺失本地引用资源: {', '.join(missing_refs[:5])}")
    if _PLACEHOLDER_RE.search(body_text):
        warnings.append("页面可见文本含 TODO / TBD / {{...}} 占位符")
    passed = len(issues) == 0
    summary = f"HTML UTF-8 有效，可见文本 {len(body_text)} 字符，本地引用缺失 {len(missing_refs)} 项"
    return _result(
        "html", passed, summary,
        metrics={"text_chars": len(body_text), "has_charset": scanner.has_charset, "missing_refs": missing_refs},
        warnings=warnings, issues=issues,
    )


def verify_pdf(path: Path) -> dict:
    issues: list[str] = []
    warnings: list[str] = []
    data = path.read_bytes()
    if not data.startswith(b"%PDF-"):
        return _result("pdf", False, "无效的 PDF 文件头", issues=["文件不以 %PDF- 开头"])
    if b"%%EOF" not in data[-2048:]:
        warnings.append("PDF 文件末尾 2KB 内未发现 %%EOF 标记，请确认文件写入完整")
    metrics: dict = {"size_bytes": len(data)}
    try:
        import pypdf  # type: ignore
        reader = pypdf.PdfReader(str(path))
        pages = len(reader.pages)
        extracted = "\n".join((page.extract_text() or "") for page in reader.pages)
        metrics.update({"pages": pages, "extracted_chars": len(extracted.strip())})
        if not extracted.strip():
            issues.append("PDF 未能提取出可检索文本（可能为纯图或字体未嵌入）")
        elif "\ufffd" in extracted:
            issues.append("PDF 文本提取出现乱码替换字符 U+FFFD")
        summary = f"PDF 共 {pages} 页，可提取文本 {len(extracted.strip())} 字符"
    except ImportError:
        pages_est = len(re.findall(rb"/Type\s*/Page\b", data))
        metrics["estimated_pages"] = pages_est
        metrics["text_check_note"] = "当前解释器未安装 pypdf，请调用 read_document 工具核验中文文本可提取性"
        warnings.append(metrics["text_check_note"])
        summary = f"PDF 头部结构有效（约 {pages_est} 页，{len(data)} 字节）；文本可提取性需配合 read_document 核验"
    passed = len(issues) == 0
    return _result("pdf", passed, summary, metrics=metrics, warnings=warnings, issues=issues)


_VERIFIERS = {
    ".xlsx": verify_xlsx,
    ".pptx": verify_pptx,
    ".docx": verify_docx,
    ".html": verify_html,
    ".htm": verify_html,
    ".pdf": verify_pdf,
}


def verify_file(path: Path) -> dict:
    if not path.is_file():
        return _result("unknown", False, f"目标文件不存在: {path}", issues=["文件不存在"])
    ext = path.suffix.lower()
    fn = _VERIFIERS.get(ext)
    if fn is None:
        return _result(ext.lstrip(".") or "unknown", False, f"暂不支持校验格式: {ext}", issues=[f"不支持格式 {ext}"])
    return fn(path)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="核验交付文档结构与基础质量")
    parser.add_argument("filepath", help="待核验文件路径")
    args = parser.parse_args(argv)
    report = verify_file(Path(args.filepath))
    sys.stdout.write(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
