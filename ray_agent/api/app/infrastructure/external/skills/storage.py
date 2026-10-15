"""不可变包存储，不接受调用方传入主机路径。"""
import hashlib
import os
import re
import shutil
import tempfile
from pathlib import Path
from app.domain.services.skill_packages import SkillError, safe_path, validate_files


class SkillStorage:
    def __init__(self, root, settings):
        self.root = Path(root).resolve()
        self.settings = settings
        self.root.mkdir(parents=True, exist_ok=True)
        for part in ('versions', 'previews'):
            (self.root / part).mkdir(exist_ok=True)

    def _dir(self, namespace, key):
        if not re.fullmatch(r'[a-f0-9]{32,64}', key):
            raise SkillError('无效存储身份')
        path = self.root / namespace / key
        if path.is_symlink() or path.resolve().parent != self.root / namespace:
            raise SkillError('Skill 存储路径异常')
        return path

    def write(self, namespace, key, files):
        files = validate_files(files, self.settings)
        dest = self._dir(namespace, key)
        if dest.exists():
            try:
                if self.read_all(namespace, key) == files:
                    return
            except SkillError:
                if namespace != 'versions':
                    raise
            if namespace != 'versions':
                raise SkillError('不可变预览内容不一致')
        tmp = Path(tempfile.mkdtemp(prefix='.publish-', dir=dest.parent))
        backup = None
        try:
            for path, raw in files.items():
                target = tmp / path
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(raw)
            try:
                os.rename(tmp, dest)
            except OSError:
                try:
                    if self.read_all(namespace, key) == files:
                        return
                except SkillError:
                    pass
                if namespace != 'versions' or dest.is_symlink():
                    raise SkillError('不可变包校验不一致')
                # 经共享服务重新验证的同一哈希内容可以修复损坏副本，不产生新版本。
                import uuid
                backup = dest.parent / ('.publish-' + uuid.uuid4().hex)
                os.rename(dest, backup)
                try:
                    os.rename(tmp, dest)
                except OSError:
                    if not dest.exists():
                        os.rename(backup, dest)
                        backup = None
                        raise
                    if self.read_all(namespace, key) != files:
                        raise SkillError('Skill 材料修复竞争，请重试')
        finally:
            if tmp.exists():
                shutil.rmtree(tmp)
            if backup is not None and backup.exists():
                if backup.is_dir():
                    shutil.rmtree(backup)
                else:
                    backup.unlink()

    def read_all(self, namespace, key):
        base = self._dir(namespace, key)
        if not base.is_dir():
            raise SkillError('Skill 缺失，请重新导入', 409)
        result = {}
        for path in base.rglob('*'):
            if path.is_symlink():
                raise SkillError('Skill 出现符号链接', 409)
            if path.is_file():
                if path.stat().st_size > self.settings.skill_file_bytes:
                    raise SkillError('存储文件大小超限', 409)
                result[path.relative_to(base).as_posix()] = path.read_bytes()
        return validate_files(result, self.settings)

    def read(self, version, manifest, path):
        path = safe_path(path)
        entry = next((f for f in manifest if f['path'] == path), None)
        if entry is None:
            raise SkillError('资源不属于当前 Skill', 404)
        target = self._dir('versions', version) / path
        if any(p.is_symlink() for p in [target, *target.parents] if p != self.root.parent):
            raise SkillError('Skill 资源路径异常', 409)
        try:
            if target.stat().st_size > self.settings.skill_file_bytes:
                raise SkillError('存储文件大小超限', 409)
            raw = target.read_bytes()
        except OSError as exc:
            raise SkillError('Skill 资源缺失，请重新导入', 409) from exc
        if len(raw) != entry['size'] or hashlib.sha256(raw).hexdigest() != entry['sha256']:
            raise SkillError('Skill 资源完整性校验失败', 409)
        return raw

    def remove(self, namespace, key):
        path = self._dir(namespace, key)
        if path.exists():
            shutil.rmtree(path)

    def collect_temporary(self, age_seconds):
        import time
        for namespace in ('versions', 'previews'):
            for path in (self.root / namespace).iterdir():
                if path.name.startswith('.publish-') and not path.is_symlink() and path.is_dir() and time.time() - path.stat().st_mtime > age_seconds:
                    shutil.rmtree(path)
