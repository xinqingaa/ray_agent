"""文档格式识别、内容分类与索引资格：预览与入库共用扩展名判断，不执行文件内容。"""
from pathlib import Path

from app.domain.models.document_knowledge import DocumentCategory, DocumentFormat

_TEXT = {".txt"}
_MARKDOWN = {".md", ".mdx", ".markdown", ".rst"}
_CODE = {".py", ".js", ".jsx", ".ts", ".tsx", ".css", ".scss", ".less", ".sh", ".bash", ".zsh",
         ".yaml", ".yml", ".toml", ".xml", ".sql", ".go", ".rs", ".java", ".kt", ".c", ".h", ".cpp",
         ".hpp", ".cs", ".rb", ".php", ".swift", ".r", ".lua", ".pl", ".diff", ".patch",
         ".log", ".ini", ".cfg", ".conf", ".env.example"}
_JSON = {".json", ".jsonl", ".jsonc"}
_HTML = {".html", ".htm"}
_IMAGE = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tif", ".tiff"}

_FORMAT_CATEGORIES: dict[DocumentFormat, DocumentCategory] = {
    DocumentFormat.TEXT: DocumentCategory.DOCUMENTS,
    DocumentFormat.MARKDOWN: DocumentCategory.DOCUMENTS,
    DocumentFormat.PDF: DocumentCategory.DOCUMENTS,
    DocumentFormat.DOCX: DocumentCategory.DOCUMENTS,
    DocumentFormat.PPTX: DocumentCategory.DOCUMENTS,
    DocumentFormat.XLSX: DocumentCategory.SPREADSHEETS,
    DocumentFormat.CSV: DocumentCategory.SPREADSHEETS,
    DocumentFormat.TSV: DocumentCategory.SPREADSHEETS,
    DocumentFormat.IMAGE: DocumentCategory.IMAGES,
    DocumentFormat.CODE: DocumentCategory.CODE,
    DocumentFormat.JSON: DocumentCategory.CODE,
    DocumentFormat.HTML: DocumentCategory.CODE,
}


def detect_format(relative_path: str) -> DocumentFormat:
    lowered = relative_path.lower()
    if lowered.endswith(".env.example"):
        return DocumentFormat.CODE
    extension = Path(relative_path).suffix.lower()
    if extension in _TEXT:
        return DocumentFormat.TEXT
    if extension in _MARKDOWN:
        return DocumentFormat.MARKDOWN
    if extension in _CODE:
        return DocumentFormat.CODE
    if extension in _JSON:
        return DocumentFormat.JSON
    if extension in _HTML:
        return DocumentFormat.HTML
    if extension == ".pdf":
        return DocumentFormat.PDF
    if extension == ".docx":
        return DocumentFormat.DOCX
    if extension == ".pptx":
        return DocumentFormat.PPTX
    if extension == ".xlsx":
        return DocumentFormat.XLSX
    if extension == ".csv":
        return DocumentFormat.CSV
    if extension == ".tsv":
        return DocumentFormat.TSV
    if extension in _IMAGE:
        return DocumentFormat.IMAGE
    return DocumentFormat.UNSUPPORTED


def category_of(fmt: DocumentFormat) -> DocumentCategory | None:
    """将底层格式归并到索引策略的内容类别；不支持的格式返回 None。"""
    return _FORMAT_CATEGORIES.get(fmt)


def is_indexable(fmt: DocumentFormat) -> bool:
    """未知格式不计入解析范围。图片和扫描 PDF 可等待 OCR 组件。"""
    return fmt is not DocumentFormat.UNSUPPORTED
