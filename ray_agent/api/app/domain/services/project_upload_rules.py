"""前后端共用的一份版本化上传规则；前端从 API 取 JSON，不自行维护另一套名单。"""
import fnmatch
import hashlib
import json
from app.domain.services.project_paths import normalize_relative

ALWAYS = ['.git', '.svn', '.hg', '.DS_Store', 'Thumbs.db']
DEPENDENCIES = ['node_modules', 'bower_components', 'site-packages', '__pycache__', '.pytest_cache', '.mypy_cache', '.tox', '.parcel-cache', '.turbo']
CONDITIONAL = {
    'dist': ['package.json'], 'build': ['package.json'], '.next': ['package.json'], '.nuxt': ['package.json'],
    '.venv': ['pyproject.toml', 'requirements*.txt', 'setup.py', 'setup.cfg', 'Pipfile', 'pyvenv.cfg'],
    'venv': ['pyproject.toml', 'requirements*.txt', 'setup.py', 'setup.cfg', 'Pipfile', 'pyvenv.cfg'],
    'target': ['Cargo.toml', 'pom.xml'], '.gradle': ['build.gradle*'], 'Pods': ['Podfile'],
    'vendor': ['composer.json', 'go.mod', 'Gemfile'],
}
SENSITIVE = ['.env', '.env.*', '*.pem', '*.key', 'id_rsa*', '*.p12']


def rules(settings):
    result = {'max_batch_bytes': settings.project_upload_max_bytes, 'max_files': settings.project_upload_max_files,
        'max_file_bytes': settings.project_file_max_bytes, 'max_project_bytes': settings.project_max_bytes,
        'always_exclude': ALWAYS, 'dependency_directories': DEPENDENCIES,
        'conditional_directories': CONDITIONAL, 'sensitive_patterns': SENSITIVE,
        'venv_marker': 'pyvenv.cfg', 'preserve_empty_directories': False,
        'idle_timeout_seconds': 600, 'total_timeout_seconds': 1800}
    result['version'] = hashlib.sha256(json.dumps(result, sort_keys=True).encode()).hexdigest()[:20]
    return result


def classify(path, inventory, rule, *, directory=False):
    path = normalize_relative(path)
    if not path:
        return {'policy': 'always', 'reason': '非法相对路径'}
    parts = path.split('/')
    if any(part in rule['always_exclude'] for part in parts):
        return {'policy': 'always', 'reason': '版本库或系统文件'}
    directories = parts if directory else parts[:-1]
    for index, name in enumerate(directories):
        prefix = '/'.join(parts[:index+1])
        parent = '/'.join(parts[:index])
        sibling_names = {p.rsplit('/', 1)[-1] for p in inventory if p.rpartition('/')[0] == parent}
        conditional = rule['conditional_directories'].get(name, [])
        if (name in rule['dependency_directories'] or prefix + '/' + rule['venv_marker'] in inventory
                or any(fnmatch.fnmatchcase(sibling, pattern) for sibling in sibling_names for pattern in conditional)):
            return {'policy': 'optional', 'reason': '依赖或构建目录', 'confirmation_path': prefix}
    if not directory and any(fnmatch.fnmatchcase(parts[-1].lower(), p) for p in rule['sensitive_patterns']):
        return {'policy': 'optional', 'reason': '可能包含密钥或凭据', 'confirmation_path': path}
    return {'policy': 'include', 'reason': None}


def validate_paths(selection):
    paths = [item.path for item in selection.items]
    if len(paths) != len(set(paths)):
        raise ValueError('重复的 NFC 规范化上传路径')
    inventory = set(paths)
    for value in selection.inventory:
        path = normalize_relative(value)
        if not path:
            raise ValueError('扫描清单包含非法路径')
        inventory.add(path)
    for path in paths:
        parent = path.rpartition('/')[0]
        while parent:
            if parent in paths:
                raise ValueError(f'上传文件与目录冲突：{parent}')
            parent = parent.rpartition('/')[0]
    confirmed = set()
    for value in selection.include_optional:
        path = normalize_relative(value)
        if not path:
            raise ValueError('可选确认包含非法路径')
        confirmed.add(path)
    return inventory, confirmed
