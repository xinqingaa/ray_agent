"""按当前实现上报能力：文件、全文始终可用；本机命令／浏览器／语义／OCR 依赖开关与组件。"""
from typing import Awaitable, Callable, Optional

from app.domain.models.capability import Capability, CapabilityStatus, UnavailableReason
from app.domain.models.execution_settings import workspace_execution_enabled

FILE_ACCESS_DETAIL = "工作区文件夹与会话工作目录；某个工作区文件夹失联时只影响该工作区的会话"

FULL_TEXT_DETAIL = "工作区记忆、会话摘要与文件片段的全文检索（SQLite FTS5，应用层中文分词）"

SEMANTIC_DETAIL = "工作区文件片段语义召回（ONNX E5＋LanceDB）；与全文 RRF 融合"

OCR_DETAIL = "扫描 PDF／图片本机 OCR（RapidOCR＋ONNX）"

NOT_IMPLEMENTED = {
    Capability.REMOTE_CONTROL: "远程控制尚未实现",
}

# 可选探测：返回 (本机命令是否可装配, 原因说明)；浏览器／语义／OCR 组件是否可用
CommandProbe = Callable[[], Awaitable[tuple[bool, str]]]
BrowserProbe = Callable[[], Awaitable[tuple[bool, UnavailableReason | None, str]]]
ComponentProbe = Callable[[], Awaitable[tuple[bool, UnavailableReason | None, str]]]
StandaloneFlag = Callable[[], Awaitable[bool]]
WorkspaceSettings = Callable[[str], Awaitable[dict | None]]


class CapabilityService:
    def __init__(
            self,
            *,
            command_probe: Optional[CommandProbe] = None,
            browser_probe: Optional[BrowserProbe] = None,
            semantic_probe: Optional[ComponentProbe] = None,
            ocr_probe: Optional[ComponentProbe] = None,
            standalone_enabled: Optional[StandaloneFlag] = None,
            workspace_settings: Optional[WorkspaceSettings] = None,
    ) -> None:
        self._command_probe = command_probe
        self._browser_probe = browser_probe
        self._semantic_probe = semantic_probe
        self._ocr_probe = ocr_probe
        self._standalone_enabled = standalone_enabled
        self._workspace_settings = workspace_settings

    async def current(self) -> list[CapabilityStatus]:
        """握手与状态页：报告机制是否可用；具体会话是否启用执行另由 for_session 判断。"""
        return [
            await self._file(),
            await self._local_command(session_enabled=True),
            await self._browser(),
            await self._full_text(),
            await self._semantic(),
            await self._ocr(),
            *[CapabilityStatus.unavailable(capability, UnavailableReason.NOT_IMPLEMENTED, detail)
              for capability, detail in NOT_IMPLEMENTED.items()],
        ]

    async def for_session(self, workspace_id: str | None) -> list[CapabilityStatus]:
        """装配本次运行工具：未打开对应执行开关时本机命令不可用。"""
        enabled = await self._execution_enabled(workspace_id)
        return [
            await self._file(),
            await self._local_command(session_enabled=enabled),
            await self._browser(),
            await self._full_text(),
            await self._semantic(),
            await self._ocr(),
            *[CapabilityStatus.unavailable(capability, UnavailableReason.NOT_IMPLEMENTED, detail)
              for capability, detail in NOT_IMPLEMENTED.items()],
        ]

    async def execution_enabled(self, workspace_id: str | None) -> bool:
        return await self._execution_enabled(workspace_id)

    async def _execution_enabled(self, workspace_id: str | None) -> bool:
        if workspace_id:
            if self._workspace_settings is None:
                return False
            settings = await self._workspace_settings(workspace_id)
            return workspace_execution_enabled(settings)
        if self._standalone_enabled is None:
            return False
        return await self._standalone_enabled()

    async def _file(self) -> CapabilityStatus:
        return CapabilityStatus.available(Capability.FILE_ACCESS, FILE_ACCESS_DETAIL)

    async def _full_text(self) -> CapabilityStatus:
        return CapabilityStatus.available(Capability.FULL_TEXT_SEARCH, FULL_TEXT_DETAIL)

    async def _local_command(self, *, session_enabled: bool) -> CapabilityStatus:
        if not session_enabled:
            return CapabilityStatus.unavailable(
                Capability.LOCAL_COMMAND, UnavailableReason.DISABLED,
                "本机执行未启用：工作区在设置中打开，独立对话在应用设置中打开（默认关闭）")
        if self._command_probe is None:
            return CapabilityStatus.unavailable(
                Capability.LOCAL_COMMAND, UnavailableReason.DEPENDENCY_UNAVAILABLE, "执行 supervisor 尚未装配")
        ok, detail = await self._command_probe()
        if ok:
            return CapabilityStatus.available(Capability.LOCAL_COMMAND, detail)
        return CapabilityStatus.unavailable(
            Capability.LOCAL_COMMAND, UnavailableReason.DEPENDENCY_UNAVAILABLE, detail)

    async def _browser(self) -> CapabilityStatus:
        if self._browser_probe is None:
            return CapabilityStatus.unavailable(
                Capability.BROWSER, UnavailableReason.COMPONENT_MISSING, "浏览器组件尚未装配")
        ok, reason, detail = await self._browser_probe()
        if ok:
            return CapabilityStatus.available(Capability.BROWSER, detail)
        return CapabilityStatus.unavailable(
            Capability.BROWSER, reason or UnavailableReason.COMPONENT_MISSING, detail)

    async def _semantic(self) -> CapabilityStatus:
        if self._semantic_probe is None:
            return CapabilityStatus.unavailable(
                Capability.SEMANTIC_INDEX, UnavailableReason.COMPONENT_MISSING, "语义索引组件尚未装配")
        ok, reason, detail = await self._semantic_probe()
        if ok:
            return CapabilityStatus.available(Capability.SEMANTIC_INDEX, detail or SEMANTIC_DETAIL)
        return CapabilityStatus.unavailable(
            Capability.SEMANTIC_INDEX, reason or UnavailableReason.COMPONENT_MISSING,
            detail or "Embedding 组件未安装")

    async def _ocr(self) -> CapabilityStatus:
        if self._ocr_probe is None:
            return CapabilityStatus.unavailable(
                Capability.OCR, UnavailableReason.COMPONENT_MISSING, "OCR 组件尚未装配")
        ok, reason, detail = await self._ocr_probe()
        if ok:
            return CapabilityStatus.available(Capability.OCR, detail or OCR_DETAIL)
        return CapabilityStatus.unavailable(
            Capability.OCR, reason or UnavailableReason.COMPONENT_MISSING, detail or "OCR 组件未安装")
