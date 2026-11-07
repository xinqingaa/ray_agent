"""受控子进程环境：不继承核心完整环境，剥离模型密钥与冻结标记，只暴露受管运行时 PATH。"""
from __future__ import annotations

import os
import re
from collections.abc import Iterable, Mapping
from pathlib import Path

_SCRUB_EXACT = frozenset({
    "PYTHONHOME", "PYTHONPATH", "PYTHONSTARTUP", "PYTHONSAFEPATH", "VIRTUAL_ENV",
    "DYLD_LIBRARY_PATH", "DYLD_FALLBACK_LIBRARY_PATH", "DYLD_INSERT_LIBRARIES",
    "LD_LIBRARY_PATH", "LD_PRELOAD",
})
_SCRUB_PREFIXES = ("_PYI_", "_MEIPASS", "DYLD_", "LD_")
_SECRET_NAME = re.compile(
    r"(API[_-]?KEY|ACCESS[_-]?TOKEN|SECRET|PASSWORD|CREDENTIAL|PRIVATE[_-]?KEY)$",
    re.IGNORECASE,
)
_KEEP_EXACT = frozenset({
    "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "TMP", "TEMP",
    "LANG", "LC_ALL", "LC_CTYPE", "LC_MESSAGES", "TERM", "COLORTERM", "TZ", "DISPLAY",
})
ALLOWED_SYSTEM_BIN_DIRS = (
    "/usr/local/bin", "/opt/homebrew/bin",
    "/usr/bin", "/bin", "/usr/sbin", "/sbin",
)


def strip_pyinstaller_markers(env: Mapping[str, str]) -> dict[str, str]:
    return {key: value for key, value in env.items()
            if key not in _SCRUB_EXACT and not any(key.startswith(prefix) for prefix in _SCRUB_PREFIXES)}


def managed_path(runtime_bin_dirs: Iterable[Path | str] | None = None) -> str:
    parts: list[str] = []
    system = list(ALLOWED_SYSTEM_BIN_DIRS)
    for item in runtime_bin_dirs or ():
        text = str(item)
        if not text or text in system or text in parts:
            continue
        parts.append(text)
    for directory in system:
        if directory not in parts:
            parts.append(directory)
    return os.pathsep.join(parts)


def _keep_key(key: str) -> bool:
    if key in _KEEP_EXACT or key.startswith("LC_"):
        return True
    if key.endswith("_PROXY") or key.endswith("_proxy"):
        return True
    return False


def scrub_env(
        parent: Mapping[str, str] | None = None,
        runtime_bin_dirs: Iterable[Path | str] | None = None,
        *,
        extra: Mapping[str, str] | None = None,
) -> dict[str, str]:
    source = dict(parent if parent is not None else os.environ)
    kept: dict[str, str] = {}
    for key, value in source.items():
        if key in _SCRUB_EXACT or any(key.startswith(prefix) for prefix in _SCRUB_PREFIXES):
            continue
        if _SECRET_NAME.search(key):
            continue
        if key in ("PATH", "PYTHONHOME", "PYTHONPATH"):
            continue
        if not _keep_key(key):
            continue
        kept[key] = value
    kept["PATH"] = managed_path(runtime_bin_dirs)
    if extra:
        for key, value in extra.items():
            if key in _SCRUB_EXACT or any(key.startswith(prefix) for prefix in _SCRUB_PREFIXES):
                continue
            kept[key] = value
    return kept


def detect_posix_shell() -> str:
    """平台系统 Shell：优先 zsh（macOS 默认），否则 /bin/sh；不要求 bash。"""
    for candidate in ("/bin/zsh", "/bin/sh"):
        if Path(candidate).is_file() and os.access(candidate, os.X_OK):
            return candidate
    return "/bin/sh"


def shell_flags(program: str) -> list[str]:
    """执行 `-c` 命令前的附加参数。zsh 加 -f 跳过用户 rc 文件：~/.zshenv 会往 PATH 前面插目录，破坏受控 PATH。"""
    return ["-f"] if os.path.basename(program) == "zsh" else []


posix_shell_program = detect_posix_shell


def build_process_env(
        extra: Mapping[str, str] | None = None,
        runtime_bin_dirs: Iterable[Path | str] | None = None,
        *,
        source: Mapping[str, str] | None = None,
) -> dict[str, str]:
    return scrub_env(source if source is not None else os.environ,
                     runtime_bin_dirs=runtime_bin_dirs, extra=extra or {})
