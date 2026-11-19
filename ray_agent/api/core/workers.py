"""核心自带的子进程入口。

冻结后 sys.executable 就是核心入口，子进程以 `<入口> worker <名称> 参数...` 启动，由入口按名称分派；
源码运行时通过绝对路径定位 sidecar.py，再用同样的名称分派。新增 worker 在这里登记，冻结清单据此收录模块。
"""
import sys
from pathlib import Path

WORKERS = {
    "preview-parse": "app.infrastructure.external.file_preview.worker",
    "execution-supervisor": "app.infrastructure.external.execution.supervisor_server",
    "component": "app.infrastructure.external.components.worker",
    "document-parse": "app.infrastructure.external.document_parse.worker",
}


def worker_command(name: str, *args: str) -> list[str]:
    if name not in WORKERS:
        raise KeyError(name)
    entry = [sys.executable]
    if not getattr(sys, "frozen", False):
        entry.append(str(Path(__file__).resolve().parents[1] / "sidecar.py"))
    return [*entry, "worker", name, *args]
