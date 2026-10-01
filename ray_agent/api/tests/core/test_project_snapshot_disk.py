"""真实临时文件：内容对象完整性、原地恢复和分阶段故障；不是 Docker/产品验收。"""
import io
import os
from pathlib import Path
import pytest
from app.domain.models.project_snapshot import ProjectSnapshot
from app.infrastructure.external.project.managed_storage import ManagedProjectStorage
from app.infrastructure.external.project.file_io import ProjectFileIO
from app.infrastructure.external.project.snapshot_disk import SnapshotDisk, SnapshotLimitError


def setup_disk(tmp_path, **kwargs):
    storage = ManagedProjectStorage(str(tmp_path), local_bind=str(tmp_path))
    assert storage.initialize(in_container=False)
    storage.ensure_project('p')
    return storage, SnapshotDisk(storage, 'p', max_bytes=kwargs.pop('max_bytes', 1024), **kwargs)


def capture(disk, identifier):
    result = disk.capture(identifier)
    return ProjectSnapshot(id=identifier, project_id='p', source='run',
        total_bytes=result['total_bytes'], manifest_sha256=result['manifest_sha256'])


def test_content_dedup_full_hash_and_no_hardlink(tmp_path):
    storage, disk = setup_disk(tmp_path)
    disk.files.publish('materials/source', io.BytesIO(b'first'))
    first = capture(disk, 'first')
    again = capture(disk, 'again')
    objects = list((disk.root/'objects').iterdir())
    assert len(objects) == 1
    assert objects[0].stat().st_ino != (storage.files_path('p')/'materials/source').stat().st_ino
    before = (storage.files_path('p')/'materials/source').stat()
    (storage.files_path('p')/'materials/source').write_bytes(b'other')
    os.utime(storage.files_path('p')/'materials/source', ns=(before.st_atime_ns, before.st_mtime_ns))
    changed = capture(disk, 'changed')
    assert len(list((disk.root/'objects').iterdir())) == 2
    assert disk.load(first)['materials/source']['sha256'] != disk.load(changed)['materials/source']['sha256']
    disk.apply(first)
    assert (storage.files_path('p')/'materials/source').read_bytes() == b'first'


def test_restore_paths_bytes_links_root_inode_and_metadata(tmp_path):
    storage, disk = setup_disk(tmp_path)
    disk.files.publish('dir/source', io.BytesIO(b'original'))
    outside = tmp_path/'secret'; outside.write_bytes(b'private')
    disk.files.link('outside', str(outside))
    snapshot = capture(disk, 'original')
    assert snapshot.total_bytes == len(b'original')
    assert len(list((disk.root/'objects').iterdir())) == 1
    root = storage.files_path('p'); inode = root.stat().st_ino
    disk.files.publish('dir/source', io.BytesIO(b'changed'), overwrite=True)
    disk.files.publish('added/new', io.BytesIO(b'added'))
    disk.files.remove('outside')
    disk.files.publish('outside', io.BytesIO(b'not a link'))
    disk.apply(snapshot)
    assert root.stat().st_ino == inode
    assert (root/'dir/source').read_bytes() == b'original'
    assert not (root/'added').exists()
    assert os.readlink(root/'outside') == str(outside)
    assert outside.read_bytes() == b'private'
    assert disk.files.size() == len(b'original')


@pytest.mark.parametrize('failure', ['missing', 'corrupt'])
def test_bad_object_rejected_before_any_current_file_changes(tmp_path, failure):
    _, disk = setup_disk(tmp_path)
    disk.files.publish('source', io.BytesIO(b'original'))
    snapshot = capture(disk, 'good')
    object_path = next((disk.root/'objects').iterdir())
    if failure == 'missing':
        object_path.unlink()
    else:
        object_path.write_bytes(b'corrupt!')
    disk.files.publish('source', io.BytesIO(b'current'), overwrite=True)
    disk.files.publish('extra', io.BytesIO(b'keep'))
    with pytest.raises(ValueError, match='对象'):
        disk.apply(snapshot)
    assert (Path(disk.files.root)/'source').read_bytes() == b'current'
    assert (Path(disk.files.root)/'extra').read_bytes() == b'keep'


@pytest.mark.parametrize('phase', ['delete', 'overwrite', 'symlink', 'ownership'])
def test_apply_fault_can_be_idempotently_repaired(tmp_path, phase):
    _, disk = setup_disk(tmp_path)
    disk.files.publish('source', io.BytesIO(b'original'))
    disk.files.link('link', '/outside/target')
    snapshot = capture(disk, 'good')
    disk.files.publish('source', io.BytesIO(b'current'), overwrite=True)
    disk.files.publish('extra', io.BytesIO(b'extra'))
    def fail(current_phase, path):
        if current_phase == phase:
            raise OSError('注入恢复失败')
    disk.fault_hook = fail
    with pytest.raises(OSError):
        disk.apply(snapshot)
    disk.fault_hook = None
    disk.apply(snapshot)
    assert (Path(disk.files.root)/'source').read_bytes() == b'original'
    assert not (Path(disk.files.root)/'extra').exists()
    assert os.readlink(Path(disk.files.root)/'link') == '/outside/target'


def test_capture_failure_collect_only_orphans_and_keep_ready_objects(tmp_path):
    _, disk = setup_disk(tmp_path)
    disk.files.publish('source', io.BytesIO(b'original'))
    first = capture(disk, 'ready')
    disk.files.publish('source', io.BytesIO(b'changed'), overwrite=True)
    disk.fault_hook = lambda phase, path: (_ for _ in ()).throw(OSError('清单失败')) if phase == 'manifest' else None
    with pytest.raises(OSError):
        disk.capture('not-ready')
    disk.fault_hook = None
    released = disk.collect([first])
    assert released > 0
    assert not (disk.root/'manifests/not-ready.json').exists()
    assert len(list((disk.root/'objects').iterdir())) == 1
    disk.apply(first)
    assert (Path(disk.files.root)/'source').read_bytes() == b'original'


def test_limit_only_run_can_skip_and_special_file_fails(tmp_path):
    _, disk = setup_disk(tmp_path, max_bytes=4)
    disk.files.publish('source', io.BytesIO(b'large'))
    assert disk.capture('run', allow_skip=True)['state'] == 'skipped'
    with pytest.raises(SnapshotLimitError):
        disk.capture('protected')
    assert not (disk.root/'objects').exists()
    os.mkfifo(Path(disk.files.root)/'fifo')
    with pytest.raises(ValueError, match='特殊文件'):
        disk.capture('with-fifo', allow_skip=True)
