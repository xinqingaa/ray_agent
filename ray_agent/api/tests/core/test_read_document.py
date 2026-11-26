"""通用只读文档工具 FileTool.read_document 的真实格式解析、过滤、安全边界与计划模式放行测试。"""
import asyncio
import os
from pathlib import Path

from openpyxl import Workbook
from pptx import Presentation
from docx import Document

from app.domain.models.run import RunMode
from app.domain.services.flows.tool_pipeline import ToolInvocation
from app.domain.services.plan_mode import PlanModeGuard
from app.domain.services.tools.file import FileTool
from tests.support.loop_harness import FileFixture


def _run(coro):
    return asyncio.run(asyncio.wait_for(coro, 20))


def _write_sample_xlsx(path: Path) -> None:
    wb = Workbook()
    ws1 = wb.active
    ws1.title = "Sales"
    ws1.append(["Month", "Amount"])
    ws1.append(["Jan", 100])
    ws2 = wb.create_sheet("Summary")
    ws2.append(["Total", "=SUM(Sales!B2:B2)"])
    wb.save(path)


def _write_sample_docx(path: Path) -> None:
    doc = Document()
    doc.add_heading("项目周报", level=1)
    doc.add_paragraph("本周完成核心预设底座开发与验证。")
    wb_tbl = doc.add_table(rows=2, cols=2)
    wb_tbl.cell(0, 0).text = "模块"
    wb_tbl.cell(0, 1).text = "状态"
    wb_tbl.cell(1, 0).text = "预设"
    wb_tbl.cell(1, 1).text = "完成"
    doc.save(path)


def _write_sample_pptx(path: Path) -> None:
    prs = Presentation()
    for idx in (1, 2):
        slide = prs.slides.add_slide(prs.slide_layouts[1])
        slide.shapes.title.text = f"第{idx}页标题"
        slide.placeholders[1].text = f"第{idx}页核心内容"
    prs.save(path)


def _make_minimal_pdf(path: Path) -> None:
    # 构造简单有效的两页结构或走测试注入 parser 测 PDF 页码过滤；同时测试真实 worker 解析
    # 这里写入最小单页 ASCII PDF 供真实 pypdfium2/pypdf 解析
    content = b"BT /F1 12 Tf 72 720 Td (Hello RayAgent PDF) Tj ET"
    objects = [
        b"1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n",
        b"2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n",
        b"3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj\n",
        f"4 0 obj << /Length {len(content)} >> stream\n".encode() + content + b"\nendstream endobj\n",
        b"5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for obj in objects:
        offsets.append(len(out))
        out.extend(obj)
    xref_pos = len(out)
    out.extend(f"xref\n0 {len(offsets)}\n0000000000 65535 f \n".encode())
    for off in offsets[1:]:
        out.extend(f"{off:010d} 00000 n \n".encode())
    out.extend(f"trailer << /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{xref_pos}\n%%EOF\n".encode())
    path.write_bytes(bytes(out))


def test_read_document_parses_office_and_pdf_with_filters(tmp_path):
    async def check():
        fx = FileFixture()
        _write_sample_xlsx(fx.root / "report.xlsx")
        _write_sample_docx(fx.root / "brief.docx")
        _write_sample_pptx(fx.root / "deck.pptx")
        _make_minimal_pdf(fx.root / "note.pdf")

        tool = FileTool(fx.scope)

        # XLSX：工作表概览与 sheet 精确过滤
        xlsx_all = await tool.read_document("report.xlsx")
        assert xlsx_all.success
        assert xlsx_all.data["format"] == "xlsx"
        assert xlsx_all.data["sheets"] == ["Sales", "Summary"]
        assert "Jan" in xlsx_all.data["content"]

        xlsx_sheet = await tool.read_document("report.xlsx", sheet="sales")
        assert xlsx_sheet.success and xlsx_sheet.data["filtered_blocks"] == 1
        assert "100" in xlsx_sheet.data["content"]
        assert "Summary" not in xlsx_sheet.data["content"]

        # DOCX
        docx_res = await tool.read_document("brief.docx")
        assert docx_res.success and docx_res.data["format"] == "docx"
        assert "核心预设底座" in docx_res.data["content"]

        # PPTX：按页过滤
        pptx_res = await tool.read_document("deck.pptx", page_start=2, page_end=2)
        assert pptx_res.success and pptx_res.data["format"] == "pptx"
        assert pptx_res.data["pages"] == [1, 2]
        assert "第2页标题" in pptx_res.data["content"]
        assert "第1页标题" not in pptx_res.data["content"]

        # PDF：真实解析与分页参数
        pdf_res = await tool.read_document("note.pdf", page_start=1, page_end=1)
        assert pdf_res.success and pdf_res.data["format"] == "pdf"
        assert "Hello RayAgent PDF" in pdf_res.data["content"]

        # 注入多块解析器验证分页与 max_chars 截断
        async def fake_parser(_path: Path, fmt: str):
            return {
                "status": "ok",
                "format": fmt,
                "blocks": [
                    {"kind": "text", "text": "A" * 30, "locator": {"page": 1}},
                    {"kind": "text", "text": "B" * 30, "locator": {"page": 2}},
                    {"kind": "text", "text": "C" * 30, "locator": {"page": 3}},
                ],
            }

        paged_tool = FileTool(fx.scope, document_parser=fake_parser)
        p1 = await paged_tool.read_document("note.pdf", start_block=1, max_blocks=1)
        assert p1.success and p1.data["has_more"] is True and p1.data["end_block"] == 1
        p_trunc = await paged_tool.read_document("note.pdf", max_chars=45)
        assert p_trunc.success and p_trunc.data["truncated"] is True and p_trunc.data["has_more"] is True

    _run(check())


def test_read_document_enforces_scope_and_plan_mode(tmp_path):
    async def check():
        fx = FileFixture()
        tool = FileTool(fx.scope)

        # 越界、符号链接与 .rayagent 受保护目录均拒绝
        outside = tmp_path / "outside.docx"
        _write_sample_docx(outside)
        assert not (await tool.read_document(str(outside))).success

        os.symlink(outside, fx.root / "link.docx")
        assert not (await tool.read_document("link.docx")).success

        (fx.root / ".rayagent").mkdir(exist_ok=True)
        _write_sample_docx(fx.root / ".rayagent" / "secret.docx")
        assert not (await tool.read_document(".rayagent/secret.docx")).success

        # 不支持的未知二进制拒绝
        (fx.root / "blob.bin").write_bytes(b"\x00\x01\x02\x03")
        assert not (await tool.read_document("blob.bin")).success

        # PlanModeGuard 必须放行 read_document
        guard = PlanModeGuard(enabled=True)
        inv = ToolInvocation(call_id="c1", function_name="read_document", raw_arguments='{"filepath":"note.pdf"}', tool=tool)
        assert await guard(inv) is None

        # 对照：普通写工具在 PlanMode 仍被拒绝
        write_inv = ToolInvocation(call_id="c2", function_name="write_file", raw_arguments="{}", tool=tool)
        denied = await guard(write_inv)
        assert denied is not None and not denied.success
        assert RunMode.PLAN.value == "plan"

    _run(check())


def test_read_document_detects_mixed_pdf_image_pages(monkeypatch):
    import io
    from PIL import Image
    from pypdf import PdfWriter
    from pypdf.generic import ContentStream, DecodedStreamObject, DictionaryObject, NameObject, NumberObject
    from app.infrastructure.external.document_parse import worker as doc_worker

    monkeypatch.setattr(doc_worker, "_ocr_component", lambda: None)

    def _pdf_with_text_and_image(pdf_path: Path):
        # 用 pypdf 构造 3 页真实 PDF：第 1 页含长文字，第 2 页纯图片，第 3 页极短标题+图片
        writer = PdfWriter()
        img_buf = io.BytesIO()
        Image.new("RGB", (40, 40), "red").save(img_buf, format="PNG")
        img_bytes = img_buf.getvalue()

        for page_idx in range(3):
            page = writer.add_blank_page(width=612, height=792)
            font_dict = DictionaryObject({
                NameObject("/Type"): NameObject("/Font"),
                NameObject("/Subtype"): NameObject("/Type1"),
                NameObject("/BaseFont"): NameObject("/Helvetica"),
            })
            resources = DictionaryObject({NameObject("/Font"): DictionaryObject({NameObject("/F1"): font_dict})})
            if page_idx in (1, 2):
                # 嵌入真实 XObject 图片
                raw_rgb = Image.open(io.BytesIO(img_bytes)).tobytes()
                img_obj = DecodedStreamObject()
                img_obj.set_data(raw_rgb)
                img_obj.update({
                    NameObject("/Type"): NameObject("/XObject"),
                    NameObject("/Subtype"): NameObject("/Image"),
                    NameObject("/Width"): NumberObject(40),
                    NameObject("/Height"): NumberObject(40),
                    NameObject("/ColorSpace"): NameObject("/DeviceRGB"),
                    NameObject("/BitsPerComponent"): NumberObject(8),
                })
                img_ref = writer._add_object(img_obj)
                resources[NameObject("/XObject")] = DictionaryObject({NameObject("/Im1"): img_ref})
            page[NameObject("/Resources")] = resources
            ops = []
            if page_idx == 0:
                ops.append("BT /F1 12 Tf 72 720 Td (This is a sufficiently long narrative text page for normal parsing checks.) Tj ET")
            elif page_idx == 2:
                ops.append("BT /F1 12 Tf 72 720 Td (Header) Tj ET")
            if page_idx in (1, 2):
                ops.append("q 100 0 0 100 72 500 cm /Im1 Do Q")
            if ops:
                cs = ContentStream(None, writer)
                cs.set_data("\n".join(ops).encode("latin1"))
                page[NameObject("/Contents")] = writer._add_object(cs)

        with pdf_path.open("wb") as fp:
            writer.write(fp)

    async def check():
        fx = FileFixture()
        pdf_path = fx.root / "mixed.pdf"
        _pdf_with_text_and_image(pdf_path)

        parsed = doc_worker.parse_pdf(pdf_path)
        assert parsed["status"] == "ok"
        assert parsed["image_pages"] == [2, 3]

        tool = FileTool(fx.scope)
        res_all = await tool.read_document("mixed.pdf")
        assert res_all.success
        assert res_all.data["image_pages"] == [2, 3]
        assert "第 2、3 页" in res_all.message and "图片/扫描页" in res_all.message

        res_p2 = await tool.read_document("mixed.pdf", page_start=2, page_end=2)
        assert res_p2.success and res_p2.data["image_pages"] == [2]
        assert "第 2 页" in res_p2.message

        res_p1 = await tool.read_document("mixed.pdf", page_start=1, page_end=1)
        assert res_p1.success and res_p1.data["image_pages"] == []
        assert "图片/扫描页" not in res_p1.message

    _run(check())
