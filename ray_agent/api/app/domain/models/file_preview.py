"""只读预览契约；资源预算属于预览，不改变下载与 Agent 工具限制。"""
from pydantic import BaseModel, Field

TEXT_EXTENSIONS = {'.json', '.txt', '.py', '.js', '.jsx', '.ts', '.tsx', '.html', '.css',
    '.sh', '.yaml', '.yml', '.log', '.xml', '.sql', '.toml', '.ini', '.rst', '.diff'}
MARKDOWN_EXTENSIONS = {'.md', '.mdx', '.markdown'}
TABLE_EXTENSIONS = {'.csv', '.tsv', '.xlsx', '.xls'}
IMAGE_EXTENSIONS = {'.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp'}
TEXT_PAGE_BYTES = 64 * 1024
TABLE_PAGE_ROWS = 200
TABLE_PAGE_COLUMNS = 50
PREVIEW_INPUT_BYTES = 64 * 1024 * 1024
WORKBOOK_EXPANDED_BYTES = 128 * 1024 * 1024
IMAGE_MAX_PIXELS = 32 * 1024 * 1024


def preview_kind(filename: str) -> str:
    from pathlib import Path
    extension = Path(filename).suffix.lower()
    if extension in MARKDOWN_EXTENSIONS:
        return 'markdown'
    if extension in TEXT_EXTENSIONS:
        return 'text'
    if extension in TABLE_EXTENSIONS:
        return 'table'
    if extension in IMAGE_EXTENSIONS:
        return 'image'
    if extension == '.pdf':
        return 'pdf'
    return 'unavailable'


class PreviewQuery(BaseModel):
    sheet: int = Field(0, ge=0, le=1023)
    row: int = Field(0, ge=0, le=100000)
    column: int = Field(0, ge=0, le=16383)
    offset: int = Field(0, ge=0, le=2**40)
    revision: str | None = None
