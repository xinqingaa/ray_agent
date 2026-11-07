"""工作区文件夹的共享排除规则：文件 IO、列举、搜索与扫描使用同一份判断。

`.rayagent` 是应用写入身份标记的保留目录，任何路径段命中都拒绝访问且不出现在列举中。
名称先按 `fold_name` 折叠（NFKC、去掉格式字符、casefold）再比较，保留目录、版本控制、凭据与数据库的判断共用这一个折叠：
APFS 等文件系统把 ſ、K（开尔文符号）、全角点等视作同一个名字，只做 `.lower()` 会被它们绕过。
其余排除项不向模型展示，也不被扫描计入：版本控制内部、依赖缓存、常见凭据与数据库文件。其中版本控制内部、凭据与数据库
文件另外禁止模型文件工具对工作区文件夹内的这些路径显式读写（`denied_reason`）；依赖缓存只是体量大、对任务通常无意义，
显式读取仍然允许。
"""
import unicodedata
from fnmatch import fnmatchcase

RESERVED_SEGMENT = ".rayagent"
WRITE_TEMP_PREFIX = ".rayagent-write-"  # 写入的同目录临时文件，崩溃时可能残留
DELETE_TEMP_PREFIX = ".rayagent-delete-"  # 删除时先改名取得的文件，核对身份后才真正删除

VCS_DIRECTORIES = frozenset({".git", ".hg", ".svn"})
DEPENDENCY_DIRECTORIES = frozenset({"node_modules", "__pycache__", ".venv", "venv", ".tox", ".gradle",
                                    ".mypy_cache", ".pytest_cache", "bower_components"})
CREDENTIAL_PATTERNS = (".env", ".env.*", "*.pem", "*.key", "*.p12", "*.pfx", "id_rsa", "id_dsa", "id_ecdsa",
                       "id_ed25519", ".npmrc", ".pypirc", ".netrc")
DATABASE_PATTERNS = ("*.sqlite", "*.sqlite3", "*.db", "*.db-wal", "*.db-shm")


def fold_name(name: str) -> str:
    """文件名的比较形式：兼容规范化（NFKC）后折叠大小写，并去掉不可见的格式字符。

    不同文件系统对名字的等价判定各异（APFS 把 ſ 当作 s、开尔文符号当作 k，并忽略组合顺序），按字面小写比较会被
    等价写法绕过禁止规则。这里宁可多判：所有保留、凭据、数据库与版本控制判定都先经此函数，只比较折叠后的形式。"""
    text = unicodedata.normalize("NFKC", name)
    text = "".join(char for char in text if unicodedata.category(char) != "Cf")
    return unicodedata.normalize("NFKC", text.casefold())


_FILE_PATTERNS = tuple(fold_name(pattern) for pattern in CREDENTIAL_PATTERNS + DATABASE_PATTERNS)
_VCS_LOWERED = frozenset(fold_name(name) for name in VCS_DIRECTORIES)
_EXCLUDED_DIRECTORIES = frozenset(fold_name(name) for name in VCS_DIRECTORIES | DEPENDENCY_DIRECTORIES)
_RESERVED_FOLDED = fold_name(RESERVED_SEGMENT)


def is_reserved(name: str) -> bool:
    return fold_name(name) == _RESERVED_FOLDED


def is_internal_temp(name: str) -> bool:
    """应用自己的写入与删除临时文件：不出现在列举、扫描与快照中。"""
    return name.startswith((WRITE_TEMP_PREFIX, DELETE_TEMP_PREFIX))


def is_excluded(name: str, is_directory: bool) -> bool:
    """名称是否从列举、搜索与扫描中排除；保留目录总是排除。"""
    if is_reserved(name) or is_internal_temp(name):
        return True
    lowered = fold_name(name)
    if is_directory:
        return lowered in _EXCLUDED_DIRECTORIES
    return any(fnmatchcase(lowered, pattern) for pattern in _FILE_PATTERNS)


def denied_reason(parts: tuple[str, ...]) -> str | None:
    """模型文件工具不得读写的路径（工作区文件夹内的相对路径各段），返回可读原因；允许时为空。

    应用保留目录与版本控制内部目录的任一路径段命中即拒绝；凭据与数据库文件只看最后一段。依赖缓存目录不在此列。"""
    for index, part in enumerate(parts):
        lowered = fold_name(part)
        if is_reserved(part):
            return "该路径属于应用保留目录，不允许读写"
        if lowered in _VCS_LOWERED:
            return "该路径属于版本控制内部目录，不允许读写"
        if index == len(parts) - 1 and any(fnmatchcase(lowered, pattern) for pattern in _FILE_PATTERNS):
            return "该文件属于凭据或数据库文件，不允许读写"
    return None


def safe_filename(name: str) -> str:
    """上传或附件文件名转成可放入文件夹的单段名称：取最后一段，去掉控制字符，拒绝空名、点名与保留名。"""
    last = (name or "").replace("\\", "/").split("/")[-1]
    cleaned = "".join(char for char in last if ord(char) >= 32 and ord(char) != 127).strip()
    if cleaned in ("", ".", "..") or is_reserved(cleaned):
        raise ValueError("文件名无效")
    return cleaned[:255]
