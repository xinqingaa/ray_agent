"""限定新建测试项目的真实 PG/卷发布与回收故障；不注入产品 API 进程。"""
import asyncio, io, json, os, sys, uuid
from pathlib import Path
from app.infrastructure.storage.postgres import get_postgres, get_uow
from app.interfaces.service_dependencies import get_project_file_service
from app.infrastructure.external.project.snapshot_disk import SnapshotDisk
from app.domain.services.project_operations import claim, finish

async def main():
    project_id, phase, mode = sys.argv[1:]
    await get_postgres().init()
    service = get_project_file_service()
    store = service.file_io(project_id)
    assert not list(store.walk()), '仅对新建空测试目录运行'
    original = b'category,amount\nA,10\nB,20\nA,30\n'
    store.publish('source.csv', io.BytesIO(original))
    store.link('external-link', '/etc/passwd')
    async def capture():
        async with get_uow() as uow:
            op = await claim(uow, project_id, 'snapshot')
        await service._stop_owned(project_id, op.operation_id)
        value, _ = await service._capture(project_id, op.operation_id, 'upload')
        async with get_uow() as uow:
            await finish(uow, project_id, op.operation_id)
        return value
    first = await capture()
    objects = lambda: sorted(e.path for e in service.disk(project_id).private.walk() if e.path.startswith('objects/') and e.type == 'file')
    first_objects = objects()
    await capture()
    assert objects() == first_objects
    source = Path(store.root) / 'source.csv'
    mtime, inode = source.stat().st_mtime_ns, source.stat().st_ino
    with source.open('r+b') as stream:
        stream.write(original.replace(b'A,10', b'A,11'))
        stream.flush(); os.fsync(stream.fileno())
    os.utime(source, ns=(mtime, mtime))
    assert source.stat().st_ino == inode and source.stat().st_mtime_ns == mtime
    changed = await capture()
    assert len(objects()) == len(first_objects) + 1
    print('RESULT ' + json.dumps({'project_id': project_id, 'first': first, 'changed': changed,
        'dedup_objects': first_objects, 'changed_objects': objects(), 'same_inode_mtime': True}), flush=True)
    def fault(actual, path):
        if actual == phase:
            print('FAULT ' + json.dumps({'phase': actual, 'path': path, 'mode': mode}), flush=True)
            if mode == 'exit': os._exit(73)
            raise OSError('scoped snapshot fault: ' + actual)
    service.disk_factory = lambda storage, project_id, **kwargs: SnapshotDisk(storage, project_id, fault_hook=fault, **kwargs)
    if phase == 'collect':
        from datetime import datetime
        async with get_uow() as uow:
            p = await uow.project.get(project_id, lock=True)
            p.archived_at = datetime.now()
            await uow.project.save(p)
        result = await service.cleanup(project_id)
        assert result['gc_pending']
        print('PENDING ' + json.dumps(result), flush=True)
    else:
        store.publish('new.txt', io.BytesIO(uuid.uuid4().hex.encode()))
        async with get_uow() as uow:
            op = await claim(uow, project_id, 'snapshot')
        await service._stop_owned(project_id, op.operation_id)
        try:
            await service._capture(project_id, op.operation_id, 'upload')
        except OSError as error:
            print('EXPECTED ' + str(error), flush=True)
        else: raise AssertionError('fault did not fire')
        # 与进程退出一致保留持久占用，交给真实 API 启动核对。
    await get_postgres().shutdown()

asyncio.run(main())
