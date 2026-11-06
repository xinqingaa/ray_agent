"""桌面宿主拉起的核心入口，开发运行与 PyInstaller 冻结共用。

宿主先经 stdin 写入一行 JSON 启动参数（CoreLaunch）并保持管道打开；核心在回环随机端口上启动 API，
完成生命周期初始化后经 stdout 写一行 JSON 握手（CoreHandshake）。stdout 只留给握手，日志及其他输出改走 stderr。
stdin 关闭（含宿主崩溃）即视为宿主退出，核心开始正常停止。启动参数不经命令行传递。
"""
import asyncio
import multiprocessing
import os
import runpy
import shutil
import socket
import sys
import threading
from pathlib import Path

# 冻结后 sys.executable 指向本入口；现有子进程按 `sys.executable -m 模块` 启动，这里只放行已知 worker。
WORKER_MODULES = frozenset({'app.infrastructure.external.file_preview.worker'})
GRACEFUL_SHUTDOWN_SECONDS = 5
EXIT_DEADLINE_SECONDS = 20


def resource_root() -> Path:
    return Path(getattr(sys, '_MEIPASS', Path(__file__).resolve().parent))


def run_worker(module: str, args: list[str]) -> None:
    if module not in WORKER_MODULES:
        sys.exit(f'不支持的子进程模块: {module}')
    sys.argv = [module, *args]
    runpy.run_module(module, run_name='__main__', alter_sys=True)


def apply_launch(launch, root: Path) -> None:
    """依次叠加环境文件、数据目录与显式环境。资源目录只读，配置、附件与 skill 都写入数据目录。"""
    from dotenv import dotenv_values
    for path in launch.env_files:
        os.environ.update({key: value for key, value in dotenv_values(path).items() if value is not None})
    data = Path(launch.data_dir).expanduser().resolve()
    data.mkdir(parents=True, exist_ok=True)
    config = data / 'config.yaml'
    if not config.exists():
        shutil.copyfile(root / 'config.yaml', config)
    os.environ.update(APP_CONFIG_FILEPATH=str(config), FILE_STORAGE_LOCAL_DIR=str(data / 'files'),
                      SKILL_STORAGE_DIR=str(data / 'skills'))
    os.environ.update(launch.env)


def watch_host(server) -> None:
    try:
        while sys.stdin.buffer.read1(65536):
            pass
    except (OSError, ValueError):
        pass
    server.should_exit = True
    # 正常停止被卡住时不能遗留无人管理的核心。
    timer = threading.Timer(EXIT_DEADLINE_SECONDS, os._exit, args=(1,))
    timer.daemon = True
    timer.start()


def serve(channel) -> int:
    import uvicorn
    from app.main import app
    from app.domain.models.error import ErrorCode, ErrorInfo
    from app.interfaces.core_descriptor import describe_core
    from app.interfaces.schemas.core import CoreFailed, CoreReady
    from app.interfaces.service_dependencies import get_capability_service

    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.bind(('127.0.0.1', 0))
    port = sock.getsockname()[1]
    config = uvicorn.Config(app, host='127.0.0.1', port=port, log_config=None,
                            timeout_graceful_shutdown=GRACEFUL_SHUTDOWN_SECONDS)
    server = uvicorn.Server(config)
    threading.Thread(target=watch_host, args=(server,), daemon=True).start()

    def report(handshake) -> None:
        channel.write(handshake.model_dump_json() + '\n')
        channel.flush()

    async def run():
        task = asyncio.create_task(server.serve(sockets=[sock]))
        while not server.started and not task.done():
            await asyncio.sleep(0.05)
        if server.started:
            capabilities = await get_capability_service().current()
            report(CoreReady(port=port, **describe_core(capabilities)))
        else:
            report(CoreFailed(error=ErrorInfo.of(ErrorCode.INTERNAL_ERROR, '核心初始化失败，详见 stderr 日志')))
        await task

    config.setup_event_loop()
    asyncio.run(run())
    return 0 if server.started else 3


def main() -> int:
    multiprocessing.freeze_support()
    if len(sys.argv) >= 3 and sys.argv[1] == '-m':
        run_worker(sys.argv[2], sys.argv[3:])
        return 0
    channel = os.fdopen(os.dup(1), 'w', encoding='utf-8')
    os.dup2(2, 1)
    sys.stdout = sys.stderr
    line = sys.stdin.buffer.readline()
    if not line:
        return 2
    root = resource_root()
    os.chdir(root)
    # 启动参数必须在任何模块读取配置之前生效；契约模块只依赖领域模型，不读取配置。
    from app.interfaces.schemas.core import CoreLaunch
    apply_launch(CoreLaunch.model_validate_json(line), root)
    return serve(channel)


if __name__ == '__main__':
    sys.exit(main())
