"""真实临时磁盘 IO；不连接 Docker/数据库，属主须由真实 Docker 另验。"""
import hashlib
import io
import os
import stat
import pytest
from app.infrastructure.external.project.file_io import ProjectFileIO


def test_atomic_publish_hash_checks_exclusive_and_failed_overwrite(tmp_path):
    store = ProjectFileIO(tmp_path)
    original = b'original'
    result = store.publish('materials/source.csv', io.BytesIO(original),
        expected_size=len(original), expected_hash=hashlib.sha256(original).hexdigest())
    assert result['sha256'] == store.hash_file('materials/source.csv')[0]
    with pytest.raises(FileExistsError):
        store.publish('materials/source.csv', io.BytesIO(b'replace'))
    with pytest.raises(ValueError, match='哈希'):
        store.publish('materials/source.csv', io.BytesIO(b'wrong'), overwrite=True, expected_hash='0'*64)
    with pytest.raises(ValueError, match='大小'):
        store.publish('materials/source.csv', io.BytesIO(b'large'), overwrite=True, max_bytes=2)
    assert (tmp_path/'materials/source.csv').read_bytes() == original
    assert not list(tmp_path.rglob('.rayagent-tmp-*'))
    assert stat.S_IMODE((tmp_path/'materials').stat().st_mode) == 0o775
    assert stat.S_IMODE((tmp_path/'materials/source.csv').stat().st_mode) == 0o664
    store.publish('materials/source.csv', io.BytesIO(b'new'), overwrite=True)
    assert (tmp_path/'materials/source.csv').read_bytes() == b'new'


def test_parent_links_leaf_links_and_special_files_not_followed(tmp_path):
    root = tmp_path/'files'; root.mkdir()
    outside = tmp_path/'secret'; outside.mkdir(); (outside/'key').write_bytes(b'secret')
    (root/'linked').symlink_to(outside, target_is_directory=True)
    (root/'key').symlink_to(outside/'key')
    os.mkfifo(root/'fifo')
    store = ProjectFileIO(root)
    assert store.size() == 0
    entries = {e.path:e for e in store.walk()}
    assert entries['linked'].type == 'symlink'
    assert entries['key'].target == str(outside/'key')
    assert entries['fifo'].type == 'other'
    with pytest.raises(OSError):
        store.publish('linked/key', io.BytesIO(b'overwrite'), overwrite=True)
    with pytest.raises(OSError):
        with store.open_regular('key'):
            pytest.fail('必须拒绝跟随链接')
    with pytest.raises(ValueError, match='普通文件'):
        with store.open_regular('fifo'):
            pytest.fail('FIFO 不得阻塞读取')
    assert (outside/'key').read_bytes() == b'secret'


def test_same_length_mtime_restored_still_rehashes_full_content(tmp_path):
    store = ProjectFileIO(tmp_path)
    store.publish('source', io.BytesIO(b'first'))
    original = (tmp_path/'source').stat()
    before = store.hash_file('source')
    (tmp_path/'source').write_bytes(b'other')
    os.utime(tmp_path/'source', ns=(original.st_atime_ns, original.st_mtime_ns))
    after = store.hash_file('source')
    assert before[1] == after[1] and before[0] != after[0]


def test_stream_read_failure_does_not_publish_and_normalizes_paths(tmp_path):
    store = ProjectFileIO(tmp_path)
    class BrokenStream:
        count = 0
        def read(self, size):
            self.count += 1
            if self.count == 1:
                return b'partial'
            raise OSError('磁盘读取错误')
    with pytest.raises(OSError):
        store.publish('nested/new', BrokenStream())
    assert not (tmp_path/'nested/new').exists()
    assert not list(tmp_path.rglob('.rayagent-tmp-*'))
    result = store.publish('cafe\u0301.txt', io.BytesIO(b'x'))
    assert result['path'] == 'café.txt'
    assert store.size() == 1
    for path in ('../escape', '/absolute', 'x/../escape', 'x\\evil'):
        with pytest.raises(Exception):
            store.publish(path, io.BytesIO(b'x'))
