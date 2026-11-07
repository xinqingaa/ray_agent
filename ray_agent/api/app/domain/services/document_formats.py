"""文档格式识别与索引资格：预览与入库共用扩展名判断，不执行文件内容。"""
from pathlib import Path

from app.domain.models.document_knowledge import DocumentFormat

_TEXT = {".txt", ".log", ".ini", ".cfg", ".conf", ".env.example"}
_MARKDOWN = {".md", ".mdx", ".markdown", ".rst"}
_CODE = {".py", ".js", ".jsx", ".ts", ".tsx", ".css", ".scss", ".less", ".sh", ".bash", ".zsh",
         ".yaml", ".yml", ".toml", ".xml", ".sql", ".go", ".rs", ".java", ".kt", ".c", ".h", ".cpp",
         ".hpp", ".cs", ".rb", ".php", ".swift", ".r", ".lua", ".pl", ".diff", ".patch"}
_JSON = {".json", ".jsonl", ".jsonc"}
_HTML = {".html", ".htm"}
_IMAGE = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tif", ".tiff"}


def detect_format(relative_path: str) -> DocumentFormat:
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


def is_indexable(fmt: DocumentFormat) -> bool:
    """不支持的格式仍登记为失败／不支持，不进入解析队列。图片与扫描 PDF 走待组件。"""
    return fmt is not DocumentFormat.UNSUPPORTED
