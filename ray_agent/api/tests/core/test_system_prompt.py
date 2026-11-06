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
    for added in ("<file_rules>", "<shell_rules>", "browser_navigate", "deliver_files", "finalize_artifact"):
        assert added in opened
    assert "当前不可用" not in opened


def test_prompts_only_state_general_principles():
    for prompt in (SYSTEM_PROMPT, build_system_prompt(environment(*Capability)), build_en(environment(*Capability))):
        for legacy in ("沙箱中", "Ubuntu", "sudo", "/home/ubuntu", "/workspace", "Linux sandbox", "inside a Linux"):
            assert legacy not in prompt
    english = build_en(environment())
    assert "macOS" in english and "Not available right now" in english and "<file_rules>" not in english
