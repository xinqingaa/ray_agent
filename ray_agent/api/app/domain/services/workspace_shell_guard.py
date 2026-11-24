"""工作区与本机 Shell 执行守卫：
1. 工作区会话内防止向非代码项目工作区写入虚拟环境、依赖包或构建产物（代码项目走单次审批）；
2. 对工作区会话与独立对话统一拦截显式向允许目录外用户目录写入的命令，走单次审批。
"""
from __future__ import annotations

import os
import re
from dataclasses import dataclass
from typing import Optional, Sequence

from app.domain.models.event import ApprovalEvent, ApprovalStatus
from app.domain.models.identity import RootKind
from app.domain.models.tool_result import ToolResult
from app.domain.services.file_scope import FileScope, _under
from app.domain.services.flows.tool_pipeline import ToolInvocation

PROJECT_MANIFEST_FILES = frozenset({
    "package.json",
    "pyproject.toml",
    "requirements.txt",
    "setup.py",
    "setup.cfg",
    "pipfile",
    "cargo.toml",
    "go.mod",
    "pom.xml",
    "build.gradle",
    "build.gradle.kts",
    "cmakelists.txt",
    "makefile",
    "composer.json",
    "gemfile",
    "pubspec.yaml",
    "mix.exs",
    "directory.build.props",
})
PROJECT_MANIFEST_SUFFIXES = (".sln", ".csproj")

_ENV_ASSIGN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*=.*$")
_WRAPPERS = frozenset({"env", "sudo", "nohup", "time", "command", "exec"})
_PYTHON_BIN = re.compile(r"^python(\d+(\.\d+)*)?$")
_PIP_BIN = re.compile(r"^pip(\d+(\.\d+)*)?$")
_DEST_FLAGS = frozenset({
    "-t", "--target", "--prefix", "-p", "--distpath", "--workpath",
    "--out-dir", "--outdir", "-C", "--cwd", "--project", "--directory",
})
# 只用于读取输入清单的参数，指向工作区文件不算把依赖安装进工作区
_INPUT_FLAGS = frozenset({"-r", "--requirement", "-c", "--constraint", "-f", "--file"})

_HOME_VAR = re.compile(r"\$(?:\{HOME\}|HOME)(?=$|[/\\])")
_INLINE_INTERPRETERS = frozenset({
    "python", "python3", "node", "ruby", "perl", "sh", "bash", "zsh", "osascript",
})
_READONLY_INSPECTION = frozenset({
    "ls", "ll", "la", "pwd", "cat", "head", "tail", "less", "more", "grep", "egrep", "fgrep", "rg",
    "find", "stat", "file", "wc", "du", "df", "which", "type", "command", "echo", "printf", "true",
    "false", "test", "[", "readlink", "realpath", "basename", "dirname", "md5", "shasum", "sha256sum",
    "cksum", "diff", "cmp", "sort", "uniq", "cut", "env", "printenv", "uname", "whoami", "id", "date",
    "git",
})
_READONLY_GIT_SUBCOMMANDS = frozenset({"status", "log", "diff", "show", "branch", "rev-parse", "ls-files"})
_COPY_MOVE_CMDS = frozenset({"cp", "mv", "install", "ln", "rsync"})
_COPY_MOVE_VALUE_FLAGS = frozenset({"-t", "--target-directory", "-S", "--suffix", "-m", "-o", "-g", "-e", "--rsh"})
_DIRECT_WRITE_CMDS = frozenset({"tee", "mkdir", "touch", "truncate"})
_DIRECT_WRITE_VALUE_FLAGS = frozenset({"-t", "-d", "-r", "-m", "--mode", "-s", "--size", "--reference"})
_EXPLICIT_OUTPUT_FLAGS = frozenset({
    "-o", "--output", "--out", "--outdir", "--out-dir", "--dest", "--destination", "--target",
})
_INLINE_WRITE_HINTS = (
    "open(", "write_text", "write_bytes", "shutil.copy", "shutil.move",
    "os.replace", "os.rename", "writefile", "copyfile", ".save(", "to_excel", "to_csv",
)
_INLINE_HOME_PATH_RE = re.compile(r"(?:~|\$(?:\{HOME\}|HOME))(?:/[^\s'\"`(),;]+)*")
_INLINE_QUOTED_DIRS = ("Desktop", "Downloads", "Documents", "Pictures", "Movies", "Music", "Public")


@dataclass(frozen=True)
class WorkspaceShellRisk:
    category: str  # virtual_env | package_install | build_output
    label: str
    summary: str


def has_project_manifest(workspace_path: str) -> bool:
    """只检查工作区顶层是否存在标准软件项目清单，不递归扫盘。"""
    try:
        with os.scandir(workspace_path) as entries:
            for entry in entries:
                try:
                    if not entry.is_file(follow_symlinks=False):
                        continue
                except OSError:
                    continue
                lowered = entry.name.casefold()
                if lowered in PROJECT_MANIFEST_FILES or lowered.endswith(PROJECT_MANIFEST_SUFFIXES):
                    return True
    except OSError:
        return False
    return False


def _split_segments(command: str) -> list[list[str]]:
    """按 shell 控制分隔符（&&, ||, ;, |, 换行）拆成命令段并去引号，容忍未闭合引号。"""
    segments: list[list[str]] = []
    tokens: list[str] = []
    buf: list[str] = []
    quote: Optional[str] = None
    i, n = 0, len(command)

    def flush_token() -> None:
        if buf:
            tokens.append("".join(buf))
            buf.clear()

    def flush_segment() -> None:
        flush_token()
        if tokens:
            segments.append(list(tokens))
            tokens.clear()

    while i < n:
        ch = command[i]
        if quote is not None:
            if ch == "\\" and quote == '"' and i + 1 < n:
                buf.append(command[i + 1])
                i += 2
            elif ch == quote:
                quote = None
                i += 1
            else:
                buf.append(ch)
                i += 1
            continue
        if ch == "\\" and i + 1 < n:
            buf.append(command[i + 1])
            i += 2
        elif ch in ("'", '"'):
            quote = ch
            i += 1
        elif ch in ("\n", ";"):
            flush_segment()
            i += 1
        elif ch in ("&", "|"):
            flush_segment()
            i += 2 if i + 1 < n and command[i + 1] == ch else 1
        elif ch.isspace():
            flush_token()
            i += 1
        else:
            buf.append(ch)
            i += 1
    flush_segment()
    return segments


def _unwrap(tokens: list[str]) -> list[str]:
    """去掉段首环境变量赋值与包装命令（env/sudo/nohup 等）。"""
    index = 0
    while index < len(tokens):
        token = tokens[index]
        if _ENV_ASSIGN.match(token):
            index += 1
            continue
        base = os.path.basename(token).casefold()
        if base in _WRAPPERS:
            index += 1
            while index < len(tokens) and tokens[index].startswith("-"):
                index += 1
            continue
        break
    return tokens[index:]


def _first_subcommand(args: list[str]) -> Optional[str]:
    for token in args:
        if not token.startswith("-"):
            return token.casefold()
    return None


def classify_segment(tokens: list[str]) -> Optional[tuple[str, str]]:
    """识别可能向目录写入虚拟环境、第三方依赖包或构建产物的命令段。"""
    cmd = _unwrap(tokens)
    if not cmd:
        return None
    exe = os.path.basename(cmd[0]).casefold()
    args = cmd[1:]

    # 1. Python 及其模块调用
    if _PYTHON_BIN.match(exe):
        for idx, token in enumerate(args):
            if token == "-m" and idx + 1 < len(args):
                module = args[idx + 1].casefold()
                rest = args[idx + 2:]
                if module in ("venv", "virtualenv"):
                    return "virtual_env", "创建 Python 虚拟环境"
                if module == "pip":
                    sub = _first_subcommand(rest)
                    if sub in ("install", "download", "wheel"):
                        return "package_install", "安装或下载 Python 依赖包"
                if module in ("build", "pyinstaller"):
                    return "build_output", "执行 Python 打包构建"
                break
        return None

    if exe == "virtualenv":
        return "virtual_env", "创建 Python 虚拟环境"

    if _PIP_BIN.match(exe):
        sub = _first_subcommand(args)
        if sub in ("install", "download", "wheel"):
            return "package_install", "安装或下载 Python 依赖包"
        return None

    if exe == "uv":
        sub = _first_subcommand(args)
        if sub == "venv":
            return "virtual_env", "创建 Python 虚拟环境"
        if sub in ("sync", "add", "init"):
            return "package_install", "安装或初始化 Python 依赖"
        if sub == "pip":
            pos = [t.casefold() for t in args if not t.startswith("-")]
            if len(pos) >= 2 and pos[1] in ("install", "sync"):
                return "package_install", "安装 Python 依赖包"
        return None

    if exe in ("conda", "mamba", "micromamba"):
        sub = _first_subcommand(args)
        if sub == "create":
            return "virtual_env", "创建 Conda 环境"
        if sub == "install":
            return "package_install", "安装 Conda 依赖包"
        return None

    if exe == "poetry":
        pos = [t.casefold() for t in args if not t.startswith("-")]
        if pos[:2] == ["env", "use"]:
            return "virtual_env", "创建 Poetry 虚拟环境"
        if pos and pos[0] in ("install", "add"):
            return "package_install", "安装 Poetry 依赖包"
        return None

    if exe == "pipenv":
        if _first_subcommand(args) == "install":
            return "virtual_env", "创建 Pipenv 虚拟环境并安装依赖"
        return None

    # 2. Node / JS / TS 工具链
    if exe in ("npm", "pnpm", "yarn", "bun"):
        pos = [t.casefold() for t in args if not t.startswith("-")]
        if exe == "yarn" and not pos:
            return "package_install", "安装 Node 依赖包"
        if pos and pos[0] in ("install", "i", "ci", "add", "init"):
            return "package_install", "安装或初始化 Node 依赖包"
        if pos and (pos[0] == "build" or (pos[0] == "run" and len(pos) >= 2 and pos[1] == "build")):
            return "build_output", "执行前端或包构建"
        return None

    if exe in ("webpack", "esbuild", "rollup", "pyinstaller"):
        if not any(t in ("-v", "--version", "-h", "--help") for t in args):
            return "build_output", f"执行 {exe} 构建打包"
        return None

    if exe in ("vite", "next", "nuxt", "parcel"):
        if _first_subcommand(args) == "build":
            return "build_output", f"执行 {exe} 构建"
        return None

    if exe == "tsc":
        flags = {t.casefold() for t in args}
        if not flags.intersection({"--noemit", "--version", "-v", "--help", "-h"}):
            return "build_output", "执行 TypeScript 编译输出"
        return None

    # 3. 其他常见生态包管理与构建
    if exe == "cargo":
        sub = _first_subcommand(args)
        if sub in ("add", "fetch", "install"):
            return "package_install", "下载或安装 Rust 依赖"
        if sub in ("build", "test"):
            return "build_output", "执行 Rust 编译构建"
        return None

    if exe == "go":
        pos = [t.casefold() for t in args if not t.startswith("-")]
        if pos and (pos[0] in ("get", "install") or pos[:2] == ["mod", "download"]):
            return "package_install", "下载或安装 Go 依赖"
        return None

    if exe in ("composer", "bundle"):
        if _first_subcommand(args) in ("install", "require"):
            return "package_install", "安装依赖包"
        return None

    if exe in ("mvn", "gradle", "gradlew"):
        if _first_subcommand(args) in ("compile", "package", "install", "verify", "build", "assemble", "jar"):
            return "build_output", "执行项目构建"
        return None

    if exe in ("cmake", "make"):
        if not any(t in ("-v", "--version", "-h", "--help") for t in args):
            return "build_output", f"执行 {exe} 构建"
        return None

    return None


def _is_under_root(path: str, root: str) -> bool:
    real_root = os.path.realpath(root)
    real_path = os.path.realpath(path)
    return _under(real_path, real_root) is not None


def _resolve_token_path(token: str, cwd: str) -> str:
    expanded = os.path.expanduser(token)
    if os.path.isabs(expanded):
        return os.path.normpath(expanded)
    return os.path.normpath(os.path.join(cwd, expanded))


def _explicit_targets(cmd: list[str], category: str, cwd: str) -> list[str]:
    """提取显式目标路径（如 venv 路径、--prefix/--target/-p/-C 等）。"""
    targets: list[str] = []
    args = cmd[1:]
    skip_next = False
    for idx, token in enumerate(args):
        if skip_next:
            skip_next = False
            continue
        if token in _INPUT_FLAGS:
            skip_next = True
            continue
        if "=" in token and token.startswith("-"):
            flag, value = token.split("=", 1)
            if flag in _DEST_FLAGS and value:
                targets.append(_resolve_token_path(value, cwd))
            continue
        if token in _DEST_FLAGS and idx + 1 < len(args):
            targets.append(_resolve_token_path(args[idx + 1], cwd))
            skip_next = True
            continue

    # 对 `python -m venv <dir>` / `virtualenv <dir>` / `uv venv <dir>` 提取位置目标目录
    if category == "virtual_env":
        exe = os.path.basename(cmd[0]).casefold()
        tail: list[str] = []
        if _PYTHON_BIN.match(exe):
            for idx, token in enumerate(args):
                if token == "-m" and idx + 1 < len(args):
                    tail = args[idx + 2:]
                    break
        elif exe == "virtualenv":
            tail = args
        elif exe == "uv":
            for idx, token in enumerate(args):
                if token.casefold() == "venv":
                    tail = args[idx + 1:]
                    break
        skip_val = False
        for token in tail:
            if skip_val:
                skip_val = False
                continue
            if token in ("--prompt", "--python", "-p"):
                skip_val = True
                continue
            if token.startswith("-"):
                continue
            targets.append(_resolve_token_path(token, cwd))
            break
    return targets


def inspect_workspace_shell(
        command: str,
        exec_dir: Optional[str],
        workspace_path: str,
        scratch_path: str,
) -> Optional[WorkspaceShellRisk]:
    """检查命令是否会向工作区文件夹写入虚拟环境、依赖包或构建产物。"""
    cwd = os.path.realpath(exec_dir or scratch_path)
    for raw_tokens in _split_segments(command):
        cmd = _unwrap(raw_tokens)
        if not cmd:
            continue
        if cmd[0] == "cd":
            if len(cmd) == 1:
                cwd = os.path.realpath(os.path.expanduser("~"))
            elif cmd[1] != "-":
                cwd = os.path.realpath(_resolve_token_path(cmd[1], cwd))
            continue

        matched = classify_segment(cmd)
        if matched is None:
            continue
        category, label = matched

        explicit = _explicit_targets(cmd, category, cwd)
        if explicit:
            if any(_is_under_root(target, workspace_path) for target in explicit):
                return WorkspaceShellRisk(category=category, label=label, summary=" ".join(cmd[:4]))
            # 显式把虚拟环境建在 scratch 或其他非工作区路径时放行
            if category == "virtual_env":
                continue

        # 命令里直接带了指向工作区的绝对路径参数（排除 -r/-c 等输入文件参数）
        in_workspace = _is_under_root(cwd, workspace_path)
        if not in_workspace:
            skip_next = False
            for token in cmd[1:]:
                if skip_next:
                    skip_next = False
                    continue
                if token in _INPUT_FLAGS:
                    skip_next = True
                    continue
                if "=" in token and token.startswith("-"):
                    flag, value = token.split("=", 1)
                    if flag in _INPUT_FLAGS:
                        continue
                    token = value
                if os.path.isabs(token) and _is_under_root(token, workspace_path):
                    in_workspace = True
                    break

        if in_workspace:
            return WorkspaceShellRisk(category=category, label=label, summary=" ".join(cmd[:4]))
    return None


def _expand_path_token(token: str) -> str:
    home = os.path.expanduser("~")
    expanded = _HOME_VAR.sub(home, token)
    return os.path.expanduser(expanded)


def _resolve_external_path(token: str, cwd: str) -> str:
    expanded = _expand_path_token(token)
    if os.path.isabs(expanded):
        return os.path.normpath(expanded)
    return os.path.normpath(os.path.join(cwd, expanded))


def _looks_like_remote_spec(token: str) -> bool:
    return bool(re.match(r"^[A-Za-z0-9._@-]+:[^/\\]", token))


def _is_allowed_write_path(path: str, allowed_roots: Sequence[str], *, allow_home_cache: bool = False) -> bool:
    real_path = os.path.realpath(path)
    if real_path == "/dev" or real_path.startswith("/dev/"):
        return True
    safe_roots: list[str] = list(allowed_roots)
    safe_roots.extend(["/tmp", "/var/tmp"])
    if allow_home_cache:
        home = os.path.expanduser("~")
        safe_roots.extend([os.path.join(home, ".cache"), os.path.join(home, ".local")])
    for root in safe_roots:
        if root and _under(real_path, os.path.realpath(root)) is not None:
            return True
    return False


def _split_raw_segments(command: str) -> list[str]:
    """按未加引号的 shell 分隔符切出原始命令段，保留引号供重定向与内联脚本分析。"""
    segments: list[str] = []
    buf: list[str] = []
    quote: Optional[str] = None
    i, n = 0, len(command)
    while i < n:
        ch = command[i]
        if quote is not None:
            buf.append(ch)
            if ch == "\\" and quote == '"' and i + 1 < n:
                buf.append(command[i + 1])
                i += 2
            elif ch == quote:
                quote = None
                i += 1
            else:
                i += 1
            continue
        if ch == "\\" and i + 1 < n:
            buf.append(ch)
            buf.append(command[i + 1])
            i += 2
        elif ch in ("'", '"'):
            quote = ch
            buf.append(ch)
            i += 1
        elif ch in ("\n", ";"):
            seg = "".join(buf).strip()
            if seg:
                segments.append(seg)
            buf.clear()
            i += 1
        elif ch in ("&", "|"):
            # `&>` / `&>>` / `>&` / `>|` 属于重定向操作符，不是段分隔符
            prev = command[i - 1] if i > 0 else ""
            nxt = command[i + 1] if i + 1 < n else ""
            if (ch == "&" and (nxt == ">" or prev == ">")) or (ch == "|" and prev == ">"):
                buf.append(ch)
                i += 1
                continue
            seg = "".join(buf).strip()
            if seg:
                segments.append(seg)
            buf.clear()
            i += 2 if (nxt == ch or (ch == "|" and nxt == "&")) else 1
        else:
            buf.append(ch)
            i += 1
    seg = "".join(buf).strip()
    if seg:
        segments.append(seg)
    return segments


def _parse_segment_tokens_and_redirects(segment: str) -> tuple[list[str], list[str]]:
    """从单个命令段拆分普通词与输出重定向目标路径（忽略引号内字面量与 2>&1 等 fd 复制）。"""
    tokens: list[str] = []
    redirects: list[str] = []
    buf: list[str] = []
    buf_all_unquoted = True
    quote: Optional[str] = None
    expecting_redirect = False
    i, n = 0, len(segment)

    def flush_word() -> None:
        nonlocal expecting_redirect, buf_all_unquoted
        if not buf and buf_all_unquoted:
            return
        word = "".join(buf)
        buf.clear()
        buf_all_unquoted = True
        if expecting_redirect:
            if not word.startswith("&"):
                redirects.append(word)
            expecting_redirect = False
        else:
            tokens.append(word)

    while i < n:
        ch = segment[i]
        if quote is not None:
            buf_all_unquoted = False
            if ch == "\\" and quote == '"' and i + 1 < n:
                buf.append(segment[i + 1])
                i += 2
            elif ch == quote:
                quote = None
                i += 1
            else:
                buf.append(ch)
                i += 1
            continue
        if ch == "\\" and i + 1 < n:
            buf_all_unquoted = False
            buf.append(segment[i + 1])
            i += 2
            continue
        if ch in ("'", '"'):
            buf_all_unquoted = False
            quote = ch
            i += 1
            continue
        if ch == "&" and i + 1 < n and segment[i + 1] == ">" and not buf:
            # `&>` 或 `&>>` 重定向 stdout 与 stderr 到目标文件
            i += 3 if i + 2 < n and segment[i + 2] == ">" else 2
            expecting_redirect = True
            continue
        if ch == ">":
            word_so_far = "".join(buf)
            if buf_all_unquoted and word_so_far in ("0", "1", "2"):
                buf.clear()
            elif buf:
                flush_word()
            nxt = segment[i + 1] if i + 1 < n else ""
            if nxt in (">", "|"):
                i += 2
            elif nxt == "&":
                # `>&2` / `>&1` / `>&-` 属于文件描述符复制，跳过后续 fd 字面量
                i += 2
                while i < n and segment[i].isspace():
                    i += 1
                if i < n and (segment[i].isdigit() or segment[i] == "-"):
                    while i < n and not segment[i].isspace():
                        i += 1
                    buf_all_unquoted = True
                    continue
                expecting_redirect = True
                buf_all_unquoted = True
                continue
            else:
                i += 1
            expecting_redirect = True
            buf_all_unquoted = True
            continue
        if ch.isspace():
            flush_word()
            i += 1
            continue
        buf.append(ch)
        i += 1
    flush_word()
    return tokens, redirects


def _collect_external_targets(cmd: list[str], cwd: str) -> list[str]:
    """提取常见写入/复制/移动/下载/解压命令可能写往的外部路径。"""
    exe = os.path.basename(cmd[0]).casefold()
    args = cmd[1:]
    targets: list[str] = []

    if exe in _COPY_MOVE_CMDS:
        positional: list[str] = []
        explicit_dest: list[str] = []
        skip_next = False
        end_of_flags = False
        for idx, token in enumerate(args):
            if skip_next:
                skip_next = False
                continue
            if not end_of_flags and token == "--":
                end_of_flags = True
                continue
            if not end_of_flags and token.startswith("-"):
                if "=" in token:
                    flag, val = token.split("=", 1)
                    if flag in ("--target-directory",) and val:
                        explicit_dest.append(val)
                    continue
                if token in ("-t", "--target-directory") and idx + 1 < len(args):
                    explicit_dest.append(args[idx + 1])
                    skip_next = True
                    continue
                if token in _COPY_MOVE_VALUE_FLAGS:
                    skip_next = True
                continue
            positional.append(token)
        if explicit_dest:
            targets.extend(explicit_dest)
        elif len(positional) >= 2 and not _looks_like_remote_spec(positional[-1]):
            targets.append(positional[-1])
        return [_resolve_external_path(t, cwd) for t in targets]

    if exe in _DIRECT_WRITE_CMDS:
        skip_next = False
        end_of_flags = False
        for token in args:
            if skip_next:
                skip_next = False
                continue
            if not end_of_flags and token == "--":
                end_of_flags = True
                continue
            if not end_of_flags and token.startswith("-"):
                if "=" not in token and token in _DIRECT_WRITE_VALUE_FLAGS:
                    skip_next = True
                continue
            targets.append(token)
        return [_resolve_external_path(t, cwd) for t in targets]

    if exe == "dd":
        for token in args:
            if token.startswith("of=") and len(token) > 3:
                targets.append(token[3:])
        return [_resolve_external_path(t, cwd) for t in targets]

    if exe == "tar":
        skip_next = False
        for idx, token in enumerate(args):
            if skip_next:
                skip_next = False
                continue
            if "=" in token and token.startswith("--directory="):
                targets.append(token.split("=", 1)[1])
            elif token in ("-C", "--directory") and idx + 1 < len(args):
                targets.append(args[idx + 1])
                skip_next = True
        return [_resolve_external_path(t, cwd) for t in targets]

    if exe == "unzip":
        for idx, token in enumerate(args):
            if token == "-d" and idx + 1 < len(args):
                targets.append(args[idx + 1])
            elif token.startswith("-d") and len(token) > 2:
                targets.append(token[2:])
        return [_resolve_external_path(t, cwd) for t in targets]

    if exe in ("curl", "wget"):
        skip_next = False
        for idx, token in enumerate(args):
            if skip_next:
                skip_next = False
                continue
            if "=" in token and token.startswith("-"):
                flag, val = token.split("=", 1)
                if flag in ("--output", "--output-document", "--directory-prefix") and val and val != "-":
                    targets.append(val)
                continue
            if token in ("-o", "--output", "-O", "--output-document", "-P", "--directory-prefix"):
                if exe == "curl" and token == "-O":
                    continue
                if idx + 1 < len(args):
                    val = args[idx + 1]
                    if val != "-":
                        targets.append(val)
                    skip_next = True
        return [_resolve_external_path(t, cwd) for t in targets]

    # 通用显式输出标志
    for idx, token in enumerate(args):
        if "=" in token and token.startswith("-"):
            flag, val = token.split("=", 1)
            if flag in _EXPLICIT_OUTPUT_FLAGS and val:
                targets.append(val)
        elif token in _EXPLICIT_OUTPUT_FLAGS and idx + 1 < len(args):
            targets.append(args[idx + 1])
    return [_resolve_external_path(t, cwd) for t in targets]


def _inline_script_body(cmd: list[str]) -> tuple[str, Optional[str]]:
    exe = os.path.basename(cmd[0]).casefold()
    base_exe = "python" if _PYTHON_BIN.match(exe) else exe
    if base_exe not in _INLINE_INTERPRETERS:
        return base_exe, None
    flag = "-c" if base_exe in ("python", "sh", "bash", "zsh") else "-e"
    args = cmd[1:]
    for idx, token in enumerate(args):
        if token == flag and idx + 1 < len(args):
            return base_exe, args[idx + 1]
        if base_exe == "perl" and token.startswith("-e") and len(token) > 2:
            return base_exe, token[2:]
    return base_exe, None


def _inspect_inline_script(base_exe: str, body: str, cwd: str, allowed_roots: Sequence[str], depth: int) -> bool:
    if base_exe in ("sh", "bash", "zsh") and depth < 2:
        return inspect_external_write_shell(body, cwd, allowed_roots, cwd, _depth=depth + 1) is not None
    lowered = body.casefold()
    if not any(hint in lowered for hint in _INLINE_WRITE_HINTS):
        return False
    home = os.path.expanduser("~")
    real_home = os.path.realpath(home)
    candidates = [match.group(0) for match in _INLINE_HOME_PATH_RE.finditer(body)]
    # 捕获内联脚本里直接拼出的系统用户主目录绝对路径
    for home_prefix in {home, real_home}:
        escaped = re.escape(home_prefix.rstrip("/"))
        for match in re.finditer(rf"{escaped}/[^\s'\"`(),;]+", body):
            candidates.append(match.group(0))
    if ("expanduser" in lowered or "path.home" in lowered or "os.homedir" in lowered):
        for folder in _INLINE_QUOTED_DIRS:
            if re.search(rf"""['"]{folder}['"/\\]""", body):
                candidates.append(os.path.join(home, folder))
    for raw in candidates:
        resolved = _resolve_external_path(raw, cwd)
        if not _is_allowed_write_path(resolved, allowed_roots, allow_home_cache=True):
            return True
    return False


def _is_readonly_command(cmd: list[str]) -> bool:
    exe = os.path.basename(cmd[0]).casefold()
    if exe not in _READONLY_INSPECTION:
        return False
    if exe == "git":
        sub = _first_subcommand(cmd[1:])
        return sub in _READONLY_GIT_SUBCOMMANDS
    return True


def inspect_external_write_shell(
        command: str,
        exec_dir: Optional[str],
        allowed_roots: Sequence[str],
        default_cwd: str,
        *,
        _depth: int = 0,
) -> Optional[WorkspaceShellRisk]:
    """检查 Shell 命令是否显式向允许目录之外的用户目录写入、复制或移动文件。"""
    if not allowed_roots:
        return None
    cwd = os.path.realpath(exec_dir or default_cwd)
    for raw_seg in _split_raw_segments(command):
        raw_tokens, redirects = _parse_segment_tokens_and_redirects(raw_seg)
        cmd = _unwrap(raw_tokens)

        for redir in redirects:
            target = _resolve_external_path(redir, cwd)
            if not _is_allowed_write_path(target, allowed_roots):
                summary = " ".join(cmd[:4]) if cmd else f"> {redir}"
                return WorkspaceShellRisk(
                    category="external_write",
                    label="向允许目录外写入文件",
                    summary=summary,
                )

        if not cmd:
            continue
        if cmd[0] == "cd":
            if len(cmd) == 1:
                cwd = os.path.realpath(os.path.expanduser("~"))
            elif cmd[1] != "-":
                cwd = os.path.realpath(_resolve_external_path(cmd[1], cwd))
            continue

        for target in _collect_external_targets(cmd, cwd):
            if not _is_allowed_write_path(target, allowed_roots):
                return WorkspaceShellRisk(
                    category="external_write",
                    label="向允许目录外写入或复制文件",
                    summary=" ".join(cmd[:4]),
                )

        base_exe, inline_body = _inline_script_body(cmd)
        if inline_body is not None and _inspect_inline_script(base_exe, inline_body, cwd, allowed_roots, _depth):
            return WorkspaceShellRisk(
                category="external_write",
                label="通过脚本向允许目录外写入文件",
                summary=" ".join(cmd[:3]),
            )

        if not _is_allowed_write_path(cwd, allowed_roots) and not _is_readonly_command(cmd):
            return WorkspaceShellRisk(
                category="external_write",
                label="在允许目录外执行写入类命令",
                summary=" ".join(cmd[:4]),
            )
    return None


class WorkspaceShellGuard:
    """工作区与本机 Shell 执行前守卫：
    - 非代码项目工作区直接拒绝内部环境/依赖/构建写入并导向 scratch；代码项目工作区走单次审批；
    - 工作区会话与独立对话中向允许目录外用户目录写入的命令统一走单次审批。
    """

    def __init__(self, files: Optional[FileScope], default_exec_dir: Optional[str] = None) -> None:
        self._files = files
        self._default_exec_dir = default_exec_dir

    def _roots(self) -> tuple[Optional[str], Optional[str]]:
        if self._files is None:
            return None, None
        workspace = next((root.path for root in self._files.roots if root.kind is RootKind.WORKSPACE_FOLDER), None)
        scratch = next((root.path for root in self._files.roots if root.kind is RootKind.SESSION_WORKDIR), None)
        return workspace, scratch

    def _allowed_roots(self) -> list[str]:
        if self._files is None:
            return []
        return [root.path for root in self._files.roots if root.path]

    async def __call__(self, invocation: ToolInvocation) -> Optional[ToolResult]:
        if invocation.function_name != "shell_execute" or invocation.suspended:
            return None
        allowed_roots = self._allowed_roots()
        if not allowed_roots:
            return None
        command = invocation.arguments.get("command")
        if not isinstance(command, str) or not command.strip():
            return None
        workspace_path, scratch_path = self._roots()
        exec_dir = invocation.arguments.get("exec_dir")
        default_cwd = self._default_exec_dir or scratch_path or workspace_path or allowed_roots[0]
        effective_dir = exec_dir if isinstance(exec_dir, str) and exec_dir.strip() else default_cwd

        if workspace_path and scratch_path:
            risk = inspect_workspace_shell(command, effective_dir, workspace_path, scratch_path)
            if risk is not None:
                if not has_project_manifest(workspace_path):
                    return ToolResult(
                        success=False,
                        message=(
                            f"拒绝在工作区文件夹内{risk.label}（{risk.summary}）：当前工作区不是代码项目目录。"
                            f"请改在会话临时工作目录 {scratch_path} 中创建虚拟环境、安装依赖或执行构建，"
                            "仅将最终交付成果写入工作区文件夹。"
                        ),
                    )
                if invocation.approval != ApprovalStatus.APPROVED.value:
                    invocation.suspend_event = ApprovalEvent(
                        tool_call_id=invocation.call_id,
                        tool_name=invocation.toolkit_name,
                        function_name=invocation.function_name,
                        function_args=dict(invocation.arguments),
                        rule=f"workspace_guard:{risk.category}",
                    )
                return None

        external_risk = inspect_external_write_shell(command, effective_dir, allowed_roots, default_cwd)
        if external_risk is not None and invocation.approval != ApprovalStatus.APPROVED.value:
            invocation.suspend_event = ApprovalEvent(
                tool_call_id=invocation.call_id,
                tool_name=invocation.toolkit_name,
                function_name=invocation.function_name,
                function_args=dict(invocation.arguments),
                rule=f"workspace_guard:{external_risk.category}",
            )
        return None
