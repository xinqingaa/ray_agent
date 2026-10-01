"""快照对象与清单：逐字节哈希、完整发布、先校验再原地恢复、按引用回收。"""
import hashlib
import io
import json
import os
import re
import tempfile
import uuid
from dataclasses import asdict
from pathlib import Path
from app.domain.services.project_paths import normalize_relative, project_directory
from app.infrastructure.external.project.file_io import ProjectFileIO, CHUNK_BYTES


class SnapshotLimitError(ValueError):
    def __init__(self, size, limit):
        self.size, self.limit = size, limit
        super().__init__(f'项目文件 {size} 字节超过快照上限 {limit} 字节；保护快照不可跳过，请先下载或精简文件')


class SnapshotDisk:
    def __init__(self, storage, project_id, *, max_bytes, fault_hook=None):
        storage.validate(project_id)
        self.files = ProjectFileIO(storage.files_path(project_id), uid=storage.uid, gid=storage.gid)
        # private snapshots 不是沙箱可写目录；仍逐级拒绝链接。
        with project_directory(str(storage.root)) as base:
            fd = os.dup(base)
            try:
                for part in ('projects', storage.check_id(project_id), 'snapshots'):
                    try:
                        os.mkdir(part, 0o700, dir_fd=fd)
                    except FileExistsError:
                        pass
                    child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
                    os.close(fd); fd = child
            finally:
                os.close(fd)
        self.root = storage.files_path(project_id).parent / 'snapshots'
        self.private = ProjectFileIO(self.root)
        self.max_bytes, self.fault_hook = max_bytes, fault_hook

    def _fault(self, phase, path=''):
        if self.fault_hook:
            self.fault_hook(phase, path)

    @staticmethod
    def _snapshot_path(snapshot_id):
        if not re.fullmatch(r'[A-Za-z0-9_-]{1,255}', snapshot_id):
            raise ValueError('快照 id 不合法')
        return f'manifests/{snapshot_id}.json'

    def capture(self, snapshot_id, *, allow_skip=False):
        entries = list(self.files.walk())
        special = [e.path for e in entries if e.type == 'other']
        if special:
            raise ValueError('快照不支持特殊文件：' + ', '.join(special[:20]))
        size = sum(e.size for e in entries if e.type == 'file')
        if size > self.max_bytes:
            if allow_skip:
                return {'state': 'skipped', 'total_bytes': size, 'reason': '项目超过快照上限，本次运行没有快照'}
            raise SnapshotLimitError(size, self.max_bytes)
        manifest, actual_size = [], 0
        for entry in entries:
            item = asdict(entry)
            if normalize_relative(entry.path) != entry.path:
                raise ValueError(f'文件路径不是 NFC 规范形式：{entry.path}')
            if entry.type == 'file':
                digest, byte_count = hashlib.sha256(), 0
                with self.files.open_regular(entry.path) as source, tempfile.SpooledTemporaryFile(max_size=CHUNK_BYTES) as staged:
                    meta = os.fstat(source.fileno())
                    while chunk := source.read(CHUNK_BYTES):
                        digest.update(chunk); staged.write(chunk); byte_count += len(chunk)
                        if actual_size + byte_count > self.max_bytes:
                            raise SnapshotLimitError(actual_size + byte_count, self.max_bytes)
                    content_hash = digest.hexdigest()
                    object_path = 'objects/' + content_hash
                    try:
                        existing_hash, existing_size = self.private.hash_file(object_path)
                        if (existing_hash, existing_size) != (content_hash, byte_count):
                            raise ValueError(f'快照对象损坏：{entry.path} ({content_hash})')
                    except FileNotFoundError:
                        staged.seek(0)
                        self.private.publish(object_path, staged, expected_hash=content_hash, expected_size=byte_count)
                    item.update(size=byte_count, sha256=content_hash, mtime_ns=meta.st_mtime_ns)
                    actual_size += byte_count
                self._fault('object', entry.path)
            manifest.append(item)
        body = {'version': 1, 'snapshot_id': snapshot_id, 'total_bytes': actual_size, 'entries': manifest}
        data = json.dumps(body, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()
        self._fault('before_manifest')
        result = self.private.publish(self._snapshot_path(snapshot_id), io.BytesIO(data))
        self._fault('manifest')
        return {'state': 'ready', 'total_bytes': actual_size, 'manifest_sha256': result['sha256']}

    def load(self, snapshot):
        with self.private.open_regular(self._snapshot_path(snapshot.id)) as source:
            data = source.read()
        if hashlib.sha256(data).hexdigest() != snapshot.manifest_sha256:
            raise ValueError('快照清单哈希不一致')
        body = json.loads(data)
        if body.get('version') != 1 or body.get('snapshot_id') != snapshot.id:
            raise ValueError('快照清单身份不一致')
        entries = {}
        for item in body.get('entries', []):
            path = item.get('path')
            if not path or normalize_relative(path) != path or path in entries:
                raise ValueError(f'快照清单路径非法或重复：{path}')
            if item.get('type') not in ('file', 'directory', 'symlink'):
                raise ValueError(f'快照清单类型非法：{path}')
            entries[path] = item
        for path, item in entries.items():
            parent = path.rpartition('/')[0]
            while parent:
                if parent not in entries or entries[parent]['type'] != 'directory':
                    raise ValueError(f'快照中存在非目录父路径：{path}')
                parent = parent.rpartition('/')[0]
            if item['type'] == 'file':
                content_hash = item.get('sha256', '')
                if not re.fullmatch('[0-9a-f]{64}', content_hash):
                    raise ValueError(f'快照文件哈希非法：{path}')
                try:
                    actual_hash, actual_size = self.private.hash_file('objects/' + content_hash)
                except (OSError, ValueError) as exc:
                    raise ValueError(f'快照对象缺失或不可读：{path}') from exc
                if (actual_hash, actual_size) != (content_hash, item['size']):
                    raise ValueError(f'快照对象损坏：{path}')
            elif item['type'] == 'symlink' and (not isinstance(item.get('target'), str) or '\x00' in item['target']):
                raise ValueError(f'链接目标非法：{path}')
        if sum(i['size'] for i in entries.values() if i['type'] == 'file') != snapshot.total_bytes:
            raise ValueError('快照总字节数不一致')
        return entries

    def apply(self, snapshot):
        desired = self.load(snapshot)  # 所有对象先核对；失败时不改当前目录。
        inode = os.stat(self.files.root, follow_symlinks=False).st_ino
        current = list(self.files.walk())
        for entry in sorted(current, key=lambda e: (e.path.count('/'), e.path), reverse=True):
            target = desired.get(entry.path)
            if target is None or target['type'] != entry.type or entry.type == 'symlink':
                self.files.remove(entry.path)
                self._fault('delete', entry.path)
        for path, item in sorted(desired.items(), key=lambda pair: (pair[0].count('/'), pair[0])):
            if item['type'] == 'directory':
                with self.files.directory(path, create=True):
                    pass
            elif item['type'] == 'file':
                try:
                    same = self.files.hash_file(path) == (item['sha256'], item['size'])
                except FileNotFoundError:
                    same = False
                if not same:
                    with self.private.open_regular('objects/' + item['sha256']) as source:
                        self.files.publish(path, source, overwrite=True, expected_hash=item['sha256'], expected_size=item['size'])
                self._fault('overwrite', path)
            else:
                self.files.link(path, item['target'])
                self._fault('symlink', path)
            self.files.restore_metadata(item)
            self._fault('ownership', path)
        for item in sorted(desired.values(), key=lambda e: e['path'].count('/'), reverse=True):
            if item['type'] == 'directory':
                self.files.restore_metadata(item)
        actual = {entry.path: entry for entry in self.files.walk()}
        if actual.keys() != desired.keys():
            raise ValueError('恢复后的路径集合不一致')
        for path, item in desired.items():
            if actual[path].type != item['type']:
                raise ValueError(f'恢复类型不一致：{path}')
            if item['type'] == 'file' and self.files.hash_file(path) != (item['sha256'], item['size']):
                raise ValueError(f'恢复字节不一致：{path}')
            if item['type'] == 'symlink' and actual[path].target != item['target']:
                raise ValueError(f'恢复链接目标不一致：{path}')
        if os.stat(self.files.root, follow_symlinks=False).st_ino != inode:
            raise ValueError('恢复替换了项目根目录')
        return snapshot.total_bytes

    def collect(self, ready):
        # 已登记和固定的全部清单共同决定引用；事务撤销清单之后才调用。
        keep_manifests, keep_objects = set(), set()
        for snapshot in ready:
            keep_manifests.add(self._snapshot_path(snapshot.id))
            keep_objects.update('objects/' + i['sha256'] for i in self.load(snapshot).values() if i['type'] == 'file')
        released = 0
        try:
            for entry in list(self.private.walk()):
                if entry.type != 'file':
                    continue
                if entry.path in keep_manifests or entry.path in keep_objects:
                    continue
                if entry.path.startswith(('objects/', 'manifests/')):
                    self.private.remove(entry.path)
                    released += entry.size
                    self._fault('collect', entry.path)
        except Exception as exc:
            exc.released_bytes = released
            raise
        return released
