"""本机 OCR 端口。"""
from app.infrastructure.external.ocr.rapid_ocr import ocr_ready, recognize_image, recognize_pdf_pages, verify_ocr

__all__ = ["ocr_ready", "recognize_image", "recognize_pdf_pages", "verify_ocr"]
