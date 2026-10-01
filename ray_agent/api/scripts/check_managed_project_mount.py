"""真实 Docker：托管卷子路径、ubuntu 改写/删除、快照目录不可见；只清理本脚本资源。"""
import asyncio
import json
import io
import shutil
import uuid
from app.infrastructure.external.project.managed_storage import get_managed_storage
from app.infrastructure.external.sandbox.docker_sandbox import DockerSandbox
from app.infrastructure.external.project.file_io import ProjectFileIO


async def main():
    storage=get_managed_storage()
    if storage.reason:
        raise RuntimeError(storage.reason)
    project_id='mount-check-'+uuid.uuid4().hex
    files=storage.ensure_project(project_id)
    marker=files/'source.txt'
    writer = ProjectFileIO(files, uid=storage.uid, gid=storage.gid)
    writer.publish('source.txt', io.BytesIO(b'original'))
    writer.publish('nested/material.txt', io.BytesIO(b'material'))
    snapshots=files.parent/'snapshots'; snapshots.mkdir(); (snapshots/'hidden').write_text('hidden')
    box=None
    try:
        box=await DockerSandbox.create(project_id=project_id)
        await box.validate_project(project_id)
        import docker
        container=docker.from_env().containers.get(box.id)
        result=container.exec_run(['sh','-c',"printf changed > /workspace/source.txt && rm /workspace/source.txt && printf changed > /workspace/nested/material.txt && rm /workspace/nested/material.txt && test ! -e /workspace/../snapshots/hidden"],user='ubuntu')
        assert result.exit_code==0,result.output.decode()
        assert not marker.exists()
        print(json.dumps({'volume':storage.volume,'subpath':f'projects/{project_id}/files',
            'ubuntu_modify_delete':True,'unified_writer_owner':True,'snapshots_hidden':True,'container':box.id},ensure_ascii=False))
    finally:
        if box:
            assert await box.destroy(), '测试沙箱清理失败'
        shutil.rmtree(files.parent)
        print('本次项目目录与沙箱已清理')


asyncio.run(main())
