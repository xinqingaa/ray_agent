"""随包合成材料和独立断言。验证只读取已交付字节。"""
from dataclasses import dataclass
from io import BytesIO
from typing import Callable
from unicodedata import east_asian_width

from openpyxl import load_workbook
from pptx import Presentation
from pypdf import PdfReader

from app.domain.models.evaluation import EvaluationCase, EvaluationCheck

SUITE_VERSION = "office-v1"
Files = dict[str, bytes]
Verifier = Callable[[Files], list[EvaluationCheck]]


@dataclass(frozen=True)
class Case:
    info: EvaluationCase
    prompt: str
    materials: dict[str, str]
    verify: Verifier


def check(label: str, passed: bool, detail: str) -> EvaluationCheck:
    return EvaluationCheck(label=label, passed=passed, detail=detail)


def artifact(files: Files, suffix: str) -> bytes | None:
    return next((content for name, content in files.items() if name.casefold().endswith(suffix)), None)


def verify_ppt(files: Files) -> list[EvaluationCheck]:
    results = []
    formats = (
        (".pptx", "PPTX", lambda data: [
            "\n".join(shape.text for shape in slide.shapes if shape.has_text_frame)
            for slide in Presentation(BytesIO(data)).slides
        ]),
        (".pdf", "PDF", lambda data: [page.extract_text() or "" for page in PdfReader(BytesIO(data)).pages]),
    )
    for suffix, format_name, read in formats:
        content = artifact(files, suffix)
        if content is None:
            results.append(check(f"{format_name} 可打开", False, f"成果区没有交付 {format_name}"))
            continue
        try:
            pages = read(content)
        except Exception:
            results.append(check(f"{format_name} 可打开", False, "独立解析器无法打开交付文件"))
            continue
        results.append(check(f"{format_name} 可打开", bool(pages), f"读取到 {len(pages)} 页"))
        parts = ("支付对账", "17", "9", "林岚", "12月4日")
        document = "".join("".join(pages).split())
        missing = [part for part in parts if part not in document]
        detail = "中文正文及 5 项关键事实均可读"
        if missing:
            detail = "未找到 " + "、".join(missing)
        results.append(check(f"{format_name} 正文和关键事实", not missing, detail))
    return results


def verify_excel(files: Files) -> list[EvaluationCheck]:
    content = artifact(files, ".xlsx")
    if content is None:
        return [check("Excel 可打开", False, "成果区没有交付 XLSX")]
    try:
        workbook = load_workbook(BytesIO(content), data_only=True, read_only=True)
    except Exception:
        return [check("Excel 可打开", False, "独立解析器无法打开工作簿")]
    try:
        detail = workbook["明细"] if "明细" in workbook.sheetnames else None
        summary = workbook["汇总"] if "汇总" in workbook.sheetnames else None
        expected = {"R01": 320.0, "R02": 180.0, "R03": 245.0, "R04": 155.0}
        check_detail = []
        for row in detail.iter_rows(min_row=2, max_row=200, max_col=12, values_only=True) if detail else ():
            if row[0] is not None:
                check_detail.append((str(row[0]), row[2]))
        expected_totals = {"交通": 500.0, "办公": 400.0, "总额": 900.0}
        values = {}
        for row in summary.iter_rows(min_row=2, max_row=50, max_col=2, values_only=True) if summary else ():
            if row[0] in expected_totals:
                values[row[0]] = row[1]
        actual = "、".join(f"{key} {values.get(key, '未找到') if values.get(key) is not None else '未找到可读数值'}" for key in expected_totals)
        return [
            check("Excel 可打开", True, "独立解析器打开了交付文件"),
            check("四条明细准确且无重复", len(check_detail) == 4 and dict(check_detail) == expected,
                  f"实际读取 {len(check_detail)} 条，按单号和原始金额核对"),
            check("分类小计与总额正确", values == expected_totals, f"应为交通 500、办公 400、总额 900；实际 {actual}"),
        ]
    finally:
        workbook.close()


def verify_brief(files: Files) -> list[EvaluationCheck]:
    content = artifact(files, ".md")
    if content is None:
        return [check("提纲已交付", False, "成果区没有交付 Markdown")]
    try:
        text = content.decode("utf-8-sig").strip()
    except UnicodeDecodeError:
        return [check("提纲可打开", False, "文件不是 UTF-8 文本")]
    # 固定评测排版按每行 64 列折行，一页 28 行；中文宽字符占两列。
    lines = 0
    for line in text.splitlines():
        width = sum(2 if east_asian_width(char) in {"W", "F"} else 1 for char in line)
        lines += max(1, (width + 63) // 64)
    expected = ("15分钟", "周三", "周五", "陈希", "内部评审", "客户")
    compact = "".join(text.split())
    missing = [word for word in expected if word not in compact]
    return [
        check("提纲可打开", bool(text), "读取了交付的 UTF-8 正文"),
        check("符合一页限制", 0 < lines <= 28, f"按固定版式折行 {lines} 行，一页上限 28 行"),
        check("会议核心约束保留", not missing, "6 项约束均出现" if not missing else "未找到 " + "、".join(missing)),
    ]


CASES = {
    "ppt": Case(
        EvaluationCase(id="ppt", title="周会 PPT 与 PDF", criteria="两种格式可打开，中文正文与关键事实能独立核对"),
        prompt="根据附件制作 3 页中文周会汇报，标题、进度和风险清楚。正文要包含附件的 5 项关键事实。交付实际可编辑的 PPTX 和同内容的可提取中文 PDF，两份都通过 RayAgent 的本次成果交付。请实际生成文件，不需要先提问。",
        materials={"周会材料.md": "# 订单中心周会\n已完成 17 项，本周计划 9 项。当前风险是支付对账尚待复核。负责人林岚，目标 12月4日完成复核。\n只使用这些事实。"},
        verify=verify_ppt,
    ),
    "excel": Case(
        EvaluationCase(id="excel", title="报销 Excel", criteria="四条明细无重复，分类小计和总额可从已交付工作簿读取"),
        prompt="将附件整理成一个 XLSX 工作簿并通过 RayAgent 本次成果交付。保留工作表「明细」的前三列：单号、类别、金额。从第二行开始，每个单号一行，不要重复。另建「汇总」表，第一列放类别及「总额」，第二列放可直接读到的数值。金额保留两位小数。用原始明细核对汇总，无需提问。",
        materials={"报销登记.csv": "单号,类别,金额\nR01,交通,320\nR02,交通,180\nR03,办公,245\nR04,办公,155\nR02,交通,180\n"},
        verify=verify_excel,
    ),
    "brief": Case(
        EvaluationCase(id="brief", title="一页会前提纲", criteria="在固定一页版式内保留时长、决策人、不可动期限和复访"),
        prompt="根据附件写一份会前直接使用的一页 Markdown 提纲，包含开场、需决定的事项和复访安排。篇幅最多 28 行（每行约 32 个汉字），保留附件的全部不可变条件。生成 .md 文件并通过 RayAgent 本次成果交付。无需提问。",
        materials={"会前材料.md": "# 会前材料\n我与主管陈希有15分钟。周三的客户截止不能动，今天只讨论是否顺延内部评审。由陈希决定。会后周五复访。请保留这六项信息。"},
        verify=verify_brief,
    ),
}
