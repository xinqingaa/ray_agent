"""按当前实现上报能力：文件访问、本机命令与浏览器在对应端口接入前不可用；检索、OCR 与远程控制尚未实现。"""
from app.domain.models.capability import Capability, CapabilityStatus, UnavailableReason

NOT_IMPLEMENTED = {
    Capability.FILE_ACCESS: "文件读写随文件夹工作区接入，当前版本尚未提供",
    Capability.LOCAL_COMMAND: "本机命令与脚本随本机执行接入，当前版本尚未提供",
    Capability.BROWSER: "自动化浏览器随本机执行接入，当前版本尚未提供",
    Capability.FULL_TEXT_SEARCH: "工作区全文检索尚未实现",
    Capability.SEMANTIC_INDEX: "工作区语义索引尚未实现",
    Capability.OCR: "OCR 尚未实现",
    Capability.REMOTE_CONTROL: "远程控制尚未实现",
}


class CapabilityService:

    async def current(self) -> list[CapabilityStatus]:
        return [CapabilityStatus.unavailable(capability, UnavailableReason.NOT_IMPLEMENTED, NOT_IMPLEMENTED[capability])
                for capability in Capability]
