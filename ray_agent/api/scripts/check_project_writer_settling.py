"""真实 Docker 项目后台写入者停止检查。只操作本次唯一项目目录/容器，不连接模型。"""
import asyncio
import json
import shutil
import uuid
import docker
from docker.errors import NotFound
from app.infrastructure.external.project.managed_storage import get_managed_storage
from app.infrastructure.external.sandbox.docker_sandbox import DockerSandbox


async def main():
    project_id = 'settling-check-' + uuid.uuid4().hex
    storage = get_managed_storage()
    storage.ensure_project(project_id)
    sandbox = None
    kept = None
    marker = storage.files_path(project_id) / 'writer.log'
    try:
        sandbox = await DockerSandbox.create_owned(project_id, 'test-session', 'test-run')
        client = docker.from_env()
        container = client.containers.get(sandbox.id)
        labels = container.labels
        assert labels['rayagent.project_id'] == project_id
        assert labels['rayagent.session_id'] == 'test-session'
        assert labels['rayagent.run_id'] == 'test-run'
        container.exec_run(['sh', '-c', 'while :; do echo tick >> /workspace/writer.log; sleep 0.1; done'], user='ubuntu', detach=True)
        await asyncio.sleep(0.5)
        before = marker.stat().st_size
        await asyncio.sleep(0.3)
        assert marker.stat().st_size > before
        kept = await DockerSandbox.create_owned(project_id, 'waiting-session', 'waiting-run')
        await DockerSandbox.stop_other_project_writers(project_id, kept.id)
        keep_container = client.containers.get(kept.id)
        keep_container.reload()
        assert keep_container.attrs['State']['Running']
        await DockerSandbox.stop_project_writers(project_id)
        stopped_size = marker.stat().st_size
        await asyncio.sleep(0.5)
        assert marker.stat().st_size == stopped_size
        try:
            container.reload()
            assert container.status in ('exited', 'dead', 'created')
            status = container.status
        except NotFound:
            status = 'absent'
        marker.write_bytes(b'restored\n')
        await asyncio.sleep(0.3)
        assert marker.read_bytes() == b'restored\n'
        print(json.dumps({'project_id': project_id, 'container': sandbox.id,
            'old_writer_grew': True, 'stopped_status': status, 'stopped_bytes': stopped_size,
            'restored_bytes_unchanged': True, 'waiting_container_preserved': True, 'labels': labels}, ensure_ascii=False))
    finally:
        if kept:
            await kept.destroy()
        if sandbox:
            await sandbox.destroy()
        shutil.rmtree(storage.files_path(project_id).parent)
        print('本次项目目录与沙箱已清理')


asyncio.run(main())
