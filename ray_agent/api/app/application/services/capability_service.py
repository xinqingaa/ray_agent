"""按当前实现上报能力：文件访问读写工作区文件夹与会话工作目录；本机命令与浏览器在对应端口接入前不可用；检索、OCR 与远程控制尚未实现。"""
from app.domain.models.capability import Capability, CapabilityStatus, UnavailableReason

FILE_ACCESS_DETAIL = "工作区文件夹与会话工作目录；某个工作区文件夹失联时只影响该工作区的会话"

NOT_IMPLEMENTED = {
    Capability.LOCAL_COMMAND: "本机命令与脚本随本机执行接入，当前版本尚未提供",
    Capability.BROWSER: "自动化浏览器随本机执行接入，当前版本尚未提供",
    Capability.FULL_TEXT_SEARCH: "工作区全文检索尚未实现",
    Capability.SEMANTIC_INDEX: "工作区语义索引尚未实现",
    Capability.OCR: "OCR 尚未实现",
    Capability.REMOTE_CONTROL: "远程控制尚未实现",
}


class CapabilityService:

    async def current(self) -> list[CapabilityStatus]:
        return [CapabilityStatus.available(capability, FILE_ACCESS_DETAIL) if capability is Capability.FILE_ACCESS
                else CapabilityStatus.unavailable(capability, UnavailableReason.NOT_IMPLEMENTED,
                                                  NOT_IMPLEMENTED[capability])
                for capability in Capability]
