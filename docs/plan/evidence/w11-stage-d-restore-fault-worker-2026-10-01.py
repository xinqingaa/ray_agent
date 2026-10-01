import asyncio,io,json,os,sys
from pathlib import Path
from app.infrastructure.storage.postgres import get_postgres,get_uow
from app.interfaces.service_dependencies import get_project_file_service,get_project_service
from app.infrastructure.external.project.snapshot_disk import SnapshotDisk
from app.domain.services.project_operations import claim,finish

async def main():
    await get_postgres().init()
    project_id,phase,mode=sys.argv[1:]
    fs=get_project_file_service();service=get_project_service();store=fs.file_io(project_id)
    for entry in sorted(store.walk(),key=lambda e:(e.path.count('/'),e.path),reverse=True): store.remove(entry.path)
    store.publish('source.csv',io.BytesIO(b'category,amount\nA,10\nB,20\nA,30\n'))
    store.link('source-link','source.csv')
    session=await service.create_session(project_id)
    inode=Path(store.root).stat().st_ino
    async with get_uow() as uow: op=await claim(uow,project_id,'snapshot')
    await fs._stop_owned(project_id,op.operation_id)
    snapshot,_=await fs._capture(project_id,op.operation_id,'upload')
    async with get_uow() as uow: await finish(uow,project_id,op.operation_id)
    store.publish('source.csv',io.BytesIO(b'category,amount\nA,11\nB,20\nA,30\n'),overwrite=True)
    store.publish('extra/nested.txt',io.BytesIO(b'new material'))
    store.remove('source-link');store.link('source-link','extra/nested.txt')
    print('RESULT '+json.dumps({'project_id':project_id,'session_id':session.id,'target_snapshot_id':snapshot['snapshot_id'],'inode':inode,'phase':phase,'mode':mode}),flush=True)
    if mode=='setup':
        await get_postgres().shutdown()
        return
    def fault(actual,path):
        if actual==phase:
            print('FAULT '+json.dumps({'phase':actual,'path':path,'mode':mode}),flush=True)
            if mode=='exit': os._exit(73)
            raise OSError('scoped restore fault: '+actual)
    fs.disk_factory=lambda storage,project_id,**kwargs: SnapshotDisk(storage,project_id,fault_hook=fault,**kwargs)
    try: await fs.restore(project_id,snapshot['snapshot_id'])
    except OSError as exc: print('EXPECTED '+str(exc),flush=True)
    else: raise AssertionError('fault did not fire')
    await get_postgres().shutdown()
asyncio.run(main())
