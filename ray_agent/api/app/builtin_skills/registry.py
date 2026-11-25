"""内置 Skill 与场景预设的唯一声明式注册表，供 SkillService 初始化与接口下发共用。"""
from __future__ import annotations

from pathlib import Path
from typing import Dict, List, Tuple

from app.domain.models.skill_preset import BuiltinSkillSpec, PresetDefinition, PresetStarter

_SKIP_DIRS = {"__pycache__"}
_SKIP_SUFFIXES = (".pyc", ".pyo")
_SKIP_FILES = {".DS_Store"}

BUILTIN_SKILLS: Dict[str, BuiltinSkillSpec] = {
    "find-skills": BuiltinSkillSpec(
        id="find-skills",
        category="system",
        default_included=True,
    ),
    # ---- Layer 1：5 项基础能力底座 ----
    "research-grounding": BuiltinSkillSpec(
        id="research-grounding",
        category="foundation",
        default_included=True,
    ),
    "elicitation-communication": BuiltinSkillSpec(
        id="elicitation-communication",
        category="foundation",
        # 高频对话分寸主要通过预设预加载或显式选用生效，不污染自由问答目录
        default_included=False,
    ),
    "structured-thinking": BuiltinSkillSpec(
        id="structured-thinking",
        category="foundation",
        default_included=True,
    ),
    "presentation-design": BuiltinSkillSpec(
        id="presentation-design",
        category="foundation",
        default_included=True,
    ),
    "verification-critique": BuiltinSkillSpec(
        id="verification-critique",
        category="foundation",
        default_included=True,
    ),
    # ---- Layer 2：首期 6 项内置场景预设 ----
    "preset-ppt": BuiltinSkillSpec(
        id="preset-ppt",
        category="preset",
        default_included=True,
        preset=PresetDefinition(
            id="preset-ppt",
            title="制作 PPT",
            subtitle="对齐结构并生成可预览、可导出的演示稿",
            icon="presentation",
            placeholder="说明主题、受众和大致页数，也可直接拖入参考文档",
            starters=[
                PresetStarter(
                    label="工作汇报演示稿",
                    prompt="帮我做一份工作汇报演示稿：先整理核心结论和几页结构，再做成可直接预览的演示页面。",
                ),
                PresetStarter(
                    label="方案提案 / 路演",
                    prompt="帮我做一份方案提案演示稿：突出背景痛点、核心方案、收益对比与落地计划。",
                ),
                PresetStarter(
                    label="把现有文档转成 PPT",
                    prompt="请先读取我提供的材料，提炼成结构清晰、每页只讲一个重点的演示稿。",
                ),
            ],
            depends_on=["presentation-design", "verification-critique"],
            default_participate_in_memory=True,
            order=1,
        ),
    ),
    "preset-excel": BuiltinSkillSpec(
        id="preset-excel",
        category="preset",
        default_included=True,
        preset=PresetDefinition(
            id="preset-excel",
            title="清洗 Excel",
            subtitle="整合多表、修复口径并核算关键汇总",
            icon="table",
            placeholder="拖入表格并说明合并、清洗或汇总要求",
            starters=[
                PresetStarter(
                    label="合并多张表格",
                    prompt="请先盘点我提供的几张表格结构与字段差异，给出合并口径后再生成整合后的工作簿。",
                ),
                PresetStarter(
                    label="清洗去重与校验",
                    prompt="帮我清洗表格里的重复行、格式混乱和异常值，列出问题清单并输出干净表格。",
                ),
                PresetStarter(
                    label="做汇总分析与公式",
                    prompt="按我需要的维度整理汇总表并写入规范公式，同时用代码核算关键汇总值给我核对。",
                ),
            ],
            depends_on=["elicitation-communication", "verification-critique"],
            default_participate_in_memory=True,
            order=2,
        ),
    ),
    "preset-web-tool": BuiltinSkillSpec(
        id="preset-web-tool",
        category="preset",
        default_included=True,
        preset=PresetDefinition(
            id="preset-web-tool",
            title="互动网页",
            subtitle="快速做成可在应用内直接打开的小工具",
            icon="globe",
            placeholder="描述想要的小工具功能、输入输出或数据保存方式",
            starters=[
                PresetStarter(
                    label="做一个实用小工具",
                    prompt="帮我做一个可直接在应用内打开使用的单页小工具，界面干净好用，交互直接。",
                ),
                PresetStarter(
                    label="把数据做成交互看板",
                    prompt="把我提供的记录或数据做成一个支持筛选、排序和统计的交互式本地网页看板。",
                ),
                PresetStarter(
                    label="做一份可分享互动页",
                    prompt="帮我做一个结构清晰、适配桌面与手机屏幕的互动展示页，做好页面自检并登记预览。",
                ),
            ],
            depends_on=["presentation-design", "verification-critique"],
            default_participate_in_memory=True,
            order=3,
        ),
    ),
    "preset-doc-brief": BuiltinSkillSpec(
        id="preset-doc-brief",
        category="preset",
        default_included=True,
        preset=PresetDefinition(
            id="preset-doc-brief",
            title="文档提炼",
            subtitle="读透多份材料，输出一页结论或拆解",
            icon="file-text",
            placeholder="拖入文档、会议记录或粘贴内容，说明想给谁看",
            starters=[
                PresetStarter(
                    label="一页决策速览",
                    prompt="请通读我提供的材料，按「核心结论 / 关键依据 / 风险与待确认」提炼成一页速览。",
                ),
                PresetStarter(
                    label="会议纪要与行动项",
                    prompt="帮我把会议记录整理为结构化纪要：对齐了什么、还有哪些分歧、谁负责什么和截止时间。",
                ),
                PresetStarter(
                    label="多文档口径对比",
                    prompt="请对照这几份文档，找出事实一致项、口径冲突点与各自缺失的信息，并逐条标明出处。",
                ),
            ],
            depends_on=["research-grounding", "elicitation-communication", "verification-critique"],
            default_participate_in_memory=True,
            order=4,
        ),
    ),
    "preset-interview": BuiltinSkillSpec(
        id="preset-interview",
        category="preset",
        # 强三模式状态机，主要从首页预设或显式选择进入
        default_included=False,
        preset=PresetDefinition(
            id="preset-interview",
            title="面试准备",
            subtitle="模拟追问、打磨简历或摸底岗位行情",
            icon="briefcase",
            placeholder="贴入目标岗位 / 拖入简历，或直接点下方选定准备模式",
            starters=[
                PresetStarter(
                    label="模拟面试官追问",
                    prompt="请进入【模拟面试官】模式：你一次只问一个问题，根据我的回答做真实深挖追问，最后再统一复盘点评。",
                ),
                PresetStarter(
                    label="改简历与挖亮点",
                    prompt="请进入【教练辅导】模式：帮我梳理项目经历、用具体指标重写简历表达，并准备高频问题的回答框架。",
                ),
                PresetStarter(
                    label="查岗位行情与备考",
                    prompt="请进入【行情与备考规划】模式：帮我联网调研这个岗位的最新考察趋势、常见门槛与针对性备考计划。",
                ),
            ],
            depends_on=["elicitation-communication", "research-grounding", "structured-thinking"],
            default_participate_in_memory=True,
            order=5,
        ),
    ),
    "preset-emotional-support": BuiltinSkillSpec(
        id="preset-emotional-support",
        category="preset",
        # 高隐私情感对话不进入自由目录自动匹配，工作区下默认关闭记忆参与
        default_included=False,
        preset=PresetDefinition(
            id="preset-emotional-support",
            title="情绪疏导",
            subtitle="先接住压力与内耗，平稳后再理清头绪",
            icon="heart-handshake",
            placeholder="说说现在让你觉得累、烦躁或自责的事，哪怕只有几句也可以",
            starters=[
                PresetStarter(
                    label="先倾诉一下，不用急着给建议",
                    prompt="我现在有点难受和疲惫，想先跟你说说心里话，请先陪我聊聊、帮我稳一稳，不用急着给我列行动清单。",
                ),
                PresetStarter(
                    label="帮我把烦心事理一理",
                    prompt="我现在情绪还算稳定，想请你帮我把眼下这件烦心事拆开看看：哪些已经可控、哪些先放一放，接下来迈出最小的一步。",
                ),
            ],
            depends_on=["elicitation-communication"],
            default_participate_in_memory=False,
            order=6,
        ),
    ),
}


def validate_registry() -> None:
    """校验内置依赖引用合法且无环。"""
    for spec in BUILTIN_SKILLS.values():
        if not spec.preset:
            continue
        seen = {spec.id}
        for dep in spec.preset.depends_on:
            if dep not in BUILTIN_SKILLS:
                raise ValueError(f"内置预设 {spec.id} 依赖了未知内置 Skill: {dep}")
            if dep in seen:
                raise ValueError(f"内置预设 {spec.id} 存在重复或自依赖: {dep}")
            seen.add(dep)


validate_registry()


def preset_specs() -> List[PresetDefinition]:
    """按展示顺序返回所有内置场景预设。"""
    items = [spec.preset for spec in BUILTIN_SKILLS.values() if spec.category == "preset" and spec.preset is not None]
    return sorted(items, key=lambda item: (item.order, item.id))


def load_builtin_bundles(root: Path) -> List[Tuple[BuiltinSkillSpec, Dict[str, bytes]]]:
    """扫描随包内置目录，返回 (规格, 包内文件字节映射) 列表。"""
    bundles: List[Tuple[BuiltinSkillSpec, Dict[str, bytes]]] = []
    for spec in BUILTIN_SKILLS.values():
        skill_dir = root / spec.id
        skill_md = skill_dir / "SKILL.md"
        if not skill_md.is_file():
            raise FileNotFoundError(f"缺少内置 Skill 定义文件: {skill_md}")
        files: Dict[str, bytes] = {}
        for path in sorted(skill_dir.rglob("*")):
            if not path.is_file():
                continue
            rel = path.relative_to(skill_dir)
            if any(part in _SKIP_DIRS for part in rel.parts):
                continue
            if path.name in _SKIP_FILES or path.name.endswith(_SKIP_SUFFIXES):
                continue
            files[rel.as_posix()] = path.read_bytes()
        bundles.append((spec, files))
    return bundles
