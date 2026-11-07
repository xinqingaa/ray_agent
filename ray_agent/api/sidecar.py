"""核心入口，开发运行与 PyInstaller 冻结共用。

宿主模式（不带参数）：宿主先经 stdin 写入一行 JSON 启动参数（CoreLaunch）并保持管道打开；核心在回环随机端口上启动 API，
打开数据根并完成启动扫描后经 stdout 写一行 JSON 握手（CoreHandshake），其中带本次生成的实例令牌。stdout 只留给握手，
日志及其他输出改走 stderr。stdin 关闭（含宿主崩溃）即视为宿主退出，核心开始正常停止。启动参数不经命令行传递。

开发模式（带 --data-root）：直接启动核心，用启动参数指定数据根与端口，握手同样写到 stdout，Ctrl-C 停止。
worker 模式（`worker <名称> 参数...`）：运行 core.workers 中登记的子进程入口。
各模式都不依赖当前工作目录：资源按代码位置定位，可写数据都在数据根中，模型连接在用户配置文件中。
"""
import argparse
import asyncio
import multiprocessing
import os
import runpy
import socket
import sys
import threading
from pathlib import Path

GRACEFUL_SHUTDOWN_SECONDS = 5
EXIT_DEADLINE_SECONDS = 20


def run_worker(name: str, args: list[str]) -> None:
    from core.workers import WORKERS
    module = WORKERS.get(name)
    if module is None:
        sys.exit(f'不支持的 worker: {name}')
    sys.argv = [module, *args]
    runpy.run_module(module, run_name='__main__', alter_sys=True)


def apply_launch(launch) -> None:
    """数据根与显式环境必须在任何模块读取配置之前生效。"""
    data = Path(launch.data_dir).expanduser().resolve()
    data.mkdir(parents=True, exist_ok=True)
    os.environ['RAYAGENT_DATA_ROOT'] = str(data)
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


def serve(channel, *, port: int = 0, watch_stdin: bool = True) -> int:
    import uvicorn
    from app.main import app
    from app.interfaces.core_descriptor import describe_core, startup_failure
    from app.interfaces.instance_access import enable_instance_token
    from app.interfaces.schemas.core import CoreFailed, CoreReady
    from app.interfaces.service_dependencies import get_capability_service

    token = enable_instance_token()
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind(('127.0.0.1', port))
    port = sock.getsockname()[1]
    config = uvicorn.Config(app, host='127.0.0.1', port=port, log_config=None,
                            timeout_graceful_shutdown=GRACEFUL_SHUTDOWN_SECONDS)
    server = uvicorn.Server(config)
    if watch_stdin:
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
            report(CoreReady(port=port, instance_token=token, **describe_core(capabilities)))
        else:
            report(CoreFailed(error=startup_failure()))
        await task

    config.setup_event_loop()
    asyncio.run(run())
    return 0 if server.started else 3


def development_launch(argv: list[str]):
    parser = argparse.ArgumentParser(prog='sidecar.py', description='直接启动 RayAgent 核心（开发模式）')
    parser.add_argument('--data-root', required=True, help='数据根：业务库、内容对象、会话工作目录与 skill 存储')
    parser.add_argument('--port', type=int, default=8000, help='监听 127.0.0.1 的端口，0 表示由系统分配')
    args = parser.parse_args(argv)
    from app.interfaces.schemas.core import CoreLaunch
    return CoreLaunch(data_dir=args.data_root), args.port


def main() -> int:
    multiprocessing.freeze_support()
    if len(sys.argv) >= 3 and sys.argv[1] == 'worker':
        run_worker(sys.argv[2], sys.argv[3:])
        return 0
    channel = os.fdopen(os.dup(1), 'w', encoding='utf-8')
    os.dup2(2, 1)
    sys.stdout = sys.stderr
    # 契约模块只依赖领域模型，不读取配置；启动参数在任何模块读取配置之前生效。
    from app.interfaces.schemas.core import CoreLaunch
    if len(sys.argv) > 1:
        launch, port = development_launch(sys.argv[1:])
        apply_launch(launch)
        return serve(channel, port=port, watch_stdin=False)
    line = sys.stdin.buffer.readline()
    if not line:
        return 2
    apply_launch(CoreLaunch.model_validate_json(line))
    code = serve(channel)
    # 生命周期已收尾；stdin 监视线程可能仍阻塞在读取上，常规的解释器退出会因它持有 stdin 锁而中止。
    sys.stderr.flush()
    os._exit(code)


if __name__ == '__main__':
    sys.exit(main())
