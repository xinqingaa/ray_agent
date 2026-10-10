import asyncio
from types import SimpleNamespace
from app.infrastructure.external.project.data_cleanup_resources import DataCleanupResources
from app.infrastructure.external.project.managed_storage import ManagedProjectStorage


def test_project_cleanup_never_follows_links_and_is_idempotent(tmp_path):
    outside=tmp_path/'outside';outside.mkdir();(outside/'keep').write_text('keep')
    storage=ManagedProjectStorage(str(tmp_path/'storage'),local_bind=str(tmp_path/'storage'))
    storage.initialize(in_container=False); storage.ensure_project('owned')
    (storage.files_path('owned')/'link').symlink_to(outside,target_is_directory=True)
    resources=DataCleanupResources(storage,None,None,None)
    asyncio.run(resources.project('owned'));asyncio.run(resources.project('owned'))
    assert (outside/'keep').read_text()=='keep'
    (storage.root/'projects'/'owned').symlink_to(outside,target_is_directory=True)
    asyncio.run(resources.project('owned'))
    assert (outside/'keep').read_text()=='keep'


def test_reset_leftovers_remove_only_storage_objects_and_keep_link_targets(tmp_path):
    import uuid
    root=tmp_path/'storage'
    storage=ManagedProjectStorage(str(root),local_bind=str(root)); storage.initialize(in_container=False)
    outside=tmp_path/'outside';outside.mkdir();(outside/'keep').write_text('keep')
    (root/'projects').mkdir(exist_ok=True)
    orphan=str(uuid.uuid4()); (root/'projects'/orphan).symlink_to(outside,target_is_directory=True)
    day=root/'2026'/'10'/'10'; day.mkdir(parents=True)
    object_path=day/(str(uuid.uuid4())+'.pdf');object_path.write_text('orphan')
    keep=day/'config.yaml';keep.write_text('keep')
    (root/'2025').symlink_to(outside,target_is_directory=True)
    removed=[]
    async def keys(**kwargs):
        assert kwargs['match']=='task:input:*'
        yield 'task:input:old'
    async def delete(key): removed.append(key)
    resources=DataCleanupResources(storage,None,SimpleNamespace(file_storage_backend='local'),SimpleNamespace(scan_iter=keys,delete=delete))
    asyncio.run(resources.leftovers());asyncio.run(resources.leftovers())
    assert not object_path.exists() and not (root/'projects'/orphan).exists()
    assert keep.read_text()=='keep' and (outside/'keep').read_text()=='keep'
    assert removed==['task:input:old','task:input:old']
