"""核心自带的子进程入口。

冻结后 sys.executable 就是核心入口，子进程以 `<入口> worker <名称> 参数...` 启动，由入口按名称分派；
源码运行时等价于 `python -m <模块>`。新增 worker 在这里登记，冻结清单据此收录模块。
"""
import sys

WORKERS = {
    "preview-parse": "app.infrastructure.external.file_preview.worker",
}


def worker_command(name: str, *args: str) -> list[str]:
    module = WORKERS[name]
    if getattr(sys, "frozen", False):
        return [sys.executable, "worker", name, *args]
    return [sys.executable, "-m", module, *args]
