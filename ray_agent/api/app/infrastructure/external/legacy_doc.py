"""传统 `.doc` 只读转换适配：在 macOS 上经系统 `textutil` 临时转为 DOCX，不修改原文件并在使用后立即清理。"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
import zipfile
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

# 传统 `.doc` 转换超时：预览取 8 秒、全文索引取 30 秒，默认值同步参数页
LEGACY_DOC_PREVIEW_TIMEOUT_SECONDS = 8.0
LEGACY_DOC_PARSE_TIMEOUT_SECONDS = 30.0

_OLE2_MAGIC = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"
_ZIP_MAGIC = b"PK\x03\x04"


class LegacyDocError(RuntimeError):
    """传统 `.doc` 只读转换失败或平台不支持时给出的可读说明。"""


def _sniff_doc_format(path: Path) -> str:
    try:
        with path.open("rb") as handle:
            head = handle.read(4096)
    except OSError as exc:
        raise LegacyDocError("无法读取 .doc 文件，请检查文件权限后重试") from exc

    if head.startswith(_OLE2_MAGIC):
        return "doc"
    if head.startswith(_ZIP_MAGIC) and zipfile.is_zipfile(path):
        try:
            with zipfile.ZipFile(path) as archive:
                if "word/document.xml" in archive.namelist():
                    return "docx_direct"
        except zipfile.BadZipFile:
            pass

    stripped = head.lstrip(b"\xef\xbb\xbf \t\r\n")
    lowered = stripped.lower()
    if lowered.startswith(b"{\\rtf"):
        return "rtf"
    if lowered.startswith(b"<?xml") and (
        b"worddocument" in lowered or b"schemas.microsoft.com/office/word" in lowered
    ):
        return "wordml"
    if any(lowered.startswith(prefix) for prefix in (b"<!doctype html", b"<html", b"<head", b"<meta", b"<body")):
        return "html"
    raise LegacyDocError("该 .doc 文件内容已损坏或不是有效的 Word 文档")


def _find_textutil() -> str | None:
    if sys.platform != "darwin":
        return None
    return shutil.which("textutil") or ("/usr/bin/textutil" if os.path.isfile("/usr/bin/textutil") else None)


@contextmanager
def converted_docx(source_path: Path, *, timeout: float) -> Iterator[Path]:
    """将传统 `.doc` 只读转换为临时 DOCX 路径并在退出上下文时清理；若实为 `.docx` 则直接返回原路径。"""
    if not source_path.is_file():
        raise LegacyDocError("文件不存在")

    fmt = _sniff_doc_format(source_path)
    if fmt == "docx_direct":
        yield source_path
        return

    textutil = _find_textutil()
    if textutil is None:
        raise LegacyDocError("当前系统暂不支持直接解析传统 .doc 文档，建议在原软件中另存为 .docx 后阅读或检索")

    with tempfile.TemporaryDirectory(prefix="rayagent-doc-conv-") as tmp_dir:
        out_docx = Path(tmp_dir) / "converted.docx"
        try:
            proc = subprocess.run(
                [
                    textutil,
                    "-format",
                    fmt,
                    "-convert",
                    "docx",
                    "-noload",
                    "-nostore",
                    "-output",
                    str(out_docx),
                    "--",
                    str(source_path),
                ],
                capture_output=True,
                text=True,
                timeout=timeout,
                check=False,
                env={"PATH": "/usr/bin:/bin", "LANG": "en_US.UTF-8"},
            )
        except subprocess.TimeoutExpired as exc:
            raise LegacyDocError("传统 .doc 转换超时，请在外部软件中打开查看") from exc
        except OSError as exc:
            raise LegacyDocError("当前系统无法启动 .doc 只读转换，建议另存为 .docx 后再试") from exc

        if proc.returncode != 0 or not out_docx.is_file() or out_docx.stat().st_size <= 0:
            err_lower = (proc.stderr or "").lower()
            if any(word in err_lower for word in ("password", "encrypt", "protected")):
                raise LegacyDocError("传统 .doc 文件已加密，无法直接解析")
            raise LegacyDocError("传统 .doc 文件无法解析，可能已加密、损坏或格式不受支持")

        yield out_docx
