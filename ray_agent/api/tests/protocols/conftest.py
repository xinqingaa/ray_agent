import os
import socket
import subprocess
import sys
import time
from pathlib import Path

import pytest

FIXTURE = Path(__file__).with_name('fixture_server.py')


@pytest.fixture
def anyio_backend():
    return 'asyncio'


@pytest.fixture(scope='module')
def servers(tmp_path_factory):
    directory = tmp_path_factory.mktemp('protocols')
    processes = []
    urls = {}
    log = directory / 'calls.jsonl'
    try:
        for protocol in ['mcp', 'a2a']:
            with socket.socket() as sock:
                sock.bind(('127.0.0.1', 0))
                port = sock.getsockname()[1]
            output = open(directory / f'{protocol}.log', 'w')
            process = subprocess.Popen([sys.executable, str(FIXTURE), protocol, '--port', str(port)],
                stdout=output, stderr=output, env={**os.environ, 'RAY_PROTOCOL_LOG': str(log)})
            processes.append((process, output))
            for _ in range(100):
                if process.poll() is not None:
                    pytest.fail((directory / f'{protocol}.log').read_text())
                try:
                    with socket.create_connection(('127.0.0.1', port), timeout=.1):
                        break
                except OSError:
                    time.sleep(.1)
            else:
                pytest.fail('测试服务未启动')
            urls[protocol] = f'http://127.0.0.1:{port}'
        yield {**urls, 'log': log}
    finally:
        for process, output in processes:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill(); process.wait(timeout=5)
            output.close()
