"""系统提示词按平台、工作目录与能力声明生成，只写通用原则，不描述沙箱镜像或提权方式。"""
from app.domain.models.capability import Capability, CapabilityStatus, UnavailableReason
from app.domain.services.prompts.en.system import build_system_prompt as build_en
from app.domain.services.prompts.system import RuntimeEnvironment, SYSTEM_PROMPT, build_system_prompt


def environment(*available: Capability) -> RuntimeEnvironment:
    statuses = {capability: CapabilityStatus.available(capability) if capability in available
                else CapabilityStatus.unavailable(capability, UnavailableReason.NOT_IMPLEMENTED, f"{capability.value} 未接入")
                for capability in (Capability.FILE_ACCESS, Capability.LOCAL_COMMAND, Capability.BROWSER)}
    return RuntimeEnvironment(platform="macOS", workdir="/data/sessions/w1", uploads="/data/sessions/w1/uploads",
                              capabilities=statuses)


def test_environment_section_follows_platform_workdir_and_capabilities():
    closed = build_system_prompt(environment())
    assert "macOS" in closed and "/data/sessions/w1" in closed and "/data/sessions/w1/uploads" in closed
    assert "当前不可用：文件读写（file_access 未接入）" in closed
    for removed in ("<file_rules>", "<shell_rules>", "browser_navigate", "deliver_files", "finalize_artifact"):
        assert removed not in closed
    assert "web_fetch" in closed and "search_web" in closed and "update_plan" in closed

    opened = build_system_prompt(environment(Capability.FILE_ACCESS, Capability.LOCAL_COMMAND, Capability.BROWSER))
    for added in ("<file_rules>", "<shell_rules>", "browser_set_viewport", "deliver_files", "finalize_artifact"):
        assert added in opened
    assert "当前不可用" not in opened


def test_prompts_only_state_general_principles():
    for prompt in (SYSTEM_PROMPT, build_system_prompt(environment(*Capability)), build_en(environment(*Capability))):
        for legacy in ("沙箱中", "Ubuntu", "sudo", "/home/ubuntu", "/workspace", "Linux sandbox", "inside a Linux"):
            assert legacy not in prompt
    english = build_en(environment())
    assert "macOS" in english and "Not available right now" in english and "<file_rules>" not in english


def test_workspace_sessions_name_the_folder_scratch_directory_and_unavailable_reason():
    files = {Capability.FILE_ACCESS: CapabilityStatus.available(Capability.FILE_ACCESS)}
    bound = RuntimeEnvironment(platform="macOS", workdir="/Users/me/项目", uploads="/Users/me/项目",
                               scratch="/data/sessions/s1", capabilities=files)
    lost = RuntimeEnvironment(platform="macOS", workdir="/data/sessions/s1", uploads="/data/sessions/s1/uploads",
                              scratch="/data/sessions/s1", capabilities=files, workspace_problem="文件夹已被移动或删除")
    for build, marker in ((build_system_prompt, "工作区文件夹是 /Users/me/项目"), (build_en, "/Users/me/项目")):
        text = build(bound)
        assert marker in text and "/data/sessions/s1" in text
        problem = build(lost)
        assert "/Users/me/项目" not in problem and "/data/sessions/s1" in problem
    assert "文件夹已被移动或删除" in build_system_prompt(lost) and "文件夹已被移动或删除" in build_en(lost)
    assert "临时脚本" in build_system_prompt(bound) and "最终成果" in build_system_prompt(bound)
    assert "temporary scripts" in build_en(bound) and "final deliverables" in build_en(bound)


def test_prompts_include_delivery_lifecycle_ladder_and_verification_principles():
    zh_full = build_system_prompt(environment(Capability.FILE_ACCESS, Capability.LOCAL_COMMAND, Capability.BROWSER))
    en_full = build_en(environment(Capability.FILE_ACCESS, Capability.LOCAL_COMMAND, Capability.BROWSER))
    assert "最小复杂度阶梯" in zh_full and "单个自包含 HTML 文件" in zh_full and "register_preview" in zh_full
    assert "shell_execute 启动的临时后台进程会在本次运行结束时自动终止" in zh_full
    assert "待确认" in zh_full and "文本可提取" in zh_full
    assert "minimal-complexity ladder" in en_full and "single self-contained HTML file" in en_full and "register_preview" in en_full
    assert "terminated when the current run ends" in en_full
    assert "TBD or unconfirmed" in en_full and "text extractability" in en_full

    zh_closed = build_system_prompt(environment())
    assert "deliver_files" not in zh_closed and "shell_execute" not in zh_closed and "register_preview" not in zh_closed


def test_prompts_include_task_agnostic_collaboration_principles():
    zh = build_system_prompt(environment())
    en = build_en(environment())
    assert "<collaboration_principles>" in zh and "增量价值" in zh and "主动多想半步" in zh
    assert "<collaboration_principles>" in en and "incremental value" in en and "half a step ahead" in en
    for prompt in (zh, en):
        for preset_term in ("preset-interview", "preset-emotional-support", "preset-ppt", "12356"):
            assert preset_term not in prompt


def test_system_prompt_unties_brevity_constraints_and_profiles():
    from app.domain.services.prompts.system import SYSTEM_PROMPT
    from app.domain.services.prompts.en.system import SYSTEM_PROMPT as EN_SYSTEM_PROMPT

    for banned in ("直入重点", "不为短任务套模板或拉长篇幅", "克制、客观的书面表达", "控制篇幅"):
        assert banned not in SYSTEM_PROMPT
    assert "keep length and assets in check" not in EN_SYSTEM_PROMPT
    assert "不做刻意的长短限制" in SYSTEM_PROMPT
    assert "仅在你实际调用工具" in SYSTEM_PROMPT
    assert "no artificial brevity caps" in EN_SYSTEM_PROMPT
    assert "apply only when you actually call tools" in EN_SYSTEM_PROMPT
    assert "<image_input_rules>" not in SYSTEM_PROMPT
    assert "<image_input_rules>" not in EN_SYSTEM_PROMPT
    assert "<image_input_rules>" in build_system_prompt(environment(), include_image_rules=True)
    dialogue = build_system_prompt(environment(*Capability), profile="dialogue", preset_instruction="温暖陪伴")
    assert "<agent_loop>" not in dialogue and "<file_rules>" not in dialogue and "<shell_rules>" not in dialogue
    assert "<active_preset>" in dialogue and "温暖陪伴" in dialogue
    assert len(SYSTEM_PROMPT) < 2600
