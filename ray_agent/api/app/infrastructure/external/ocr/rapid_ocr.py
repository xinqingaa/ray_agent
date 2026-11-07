"""RapidOCR＋ONNX：扫描 PDF 页渲染与图片识别。

组件目录提供 det／rec／cls 模型；缺失时调用方保持 pending_component=ocr。
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

DET_NAME = "det.onnx"
REC_NAME = "rec.onnx"
CLS_NAME = "cls.onnx"
KEYS_NAME = "ppocr_keys_v1.txt"


def ocr_ready(component_dir: Path) -> bool:
    root = Path(component_dir)
    return (root / ".ready").is_file() and (root / DET_NAME).is_file() and (root / REC_NAME).is_file()


def _engine(component_dir: Path):
    from rapidocr_onnxruntime import RapidOCR
    root = Path(component_dir)
    kwargs: dict[str, Any] = {
        "det_model_path": str(root / DET_NAME),
        "rec_model_path": str(root / REC_NAME),
    }
    cls = root / CLS_NAME
    if cls.is_file():
        kwargs["cls_model_path"] = str(cls)
    keys = root / KEYS_NAME
    if keys.is_file():
        kwargs["rec_keys_path"] = str(keys)
    return RapidOCR(**kwargs)


def recognize_image(path: Path, component_dir: Path) -> list[dict]:
    """识别单张图片，返回带区域的文本块列表。"""
    engine = _engine(component_dir)
    result, _ = engine(str(path))
    blocks = []
    if not result:
        return blocks
    for index, item in enumerate(result):
        # item: [box, text, score]
        text = (item[1] if len(item) > 1 else "") or ""
        text = str(text).strip()
        if not text:
            continue
        box = item[0] if item else None
        locator: dict[str, Any] = {"region": index}
        if box is not None:
            locator["box"] = box
        score = float(item[2]) if len(item) > 2 else None
        if score is not None:
            locator["ocr_score"] = score
        blocks.append({"kind": "text", "text": text, "locator": locator})
    return blocks


def recognize_pdf_pages(path: Path, component_dir: Path, *, scale: float = 2.0) -> list[dict]:
    """用 pypdfium2 渲染各页再 OCR；页码写入 locator.page。"""
    import pypdfium2 as pdfium
    from PIL import Image

    engine = _engine(component_dir)
    pdf = pdfium.PdfDocument(str(path))
    blocks: list[dict] = []
    try:
        for page_index in range(len(pdf)):
            page = pdf[page_index]
            bitmap = page.render(scale=scale)
            pil = bitmap.to_pil()
            if not isinstance(pil, Image.Image):
                pil = Image.fromarray(pil)
            result, _ = engine(pil)
            if not result:
                continue
            for index, item in enumerate(result):
                text = (item[1] if len(item) > 1 else "") or ""
                text = str(text).strip()
                if not text:
                    continue
                locator: dict[str, Any] = {"page": page_index + 1, "region": index}
                if item and item[0] is not None:
                    locator["box"] = item[0]
                if len(item) > 2:
                    locator["ocr_score"] = float(item[2])
                blocks.append({"kind": "text", "text": text, "locator": locator})
    finally:
        pdf.close()
    return blocks


def verify_ocr(component_dir: Path) -> None:
    """可启动检查：构造引擎（首次加载原生库可能较慢）。"""
    engine = _engine(component_dir)
    if engine is None:
        raise RuntimeError("RapidOCR 引擎初始化失败")
