"""工作区 Shell 污染拦截：防止虚拟环境、第三方依赖包与临时构建产物写入用户工作区。

只作用于同时挂载了工作区文件夹与会话工作目录（scratch）的会话：
- 当 shell_execute 的目标目录或命令显式把环境创建、依赖安装或构建输出指向工作区时：
  - 非代码项目工作区（根目录无常见项目清单）：直接拒绝并导向 scratch；
  - 代码项目工作区（根目录存在项目清单）：挂起进入单次审批，用户确认后放行。
"""
from __future__ import annotations

import os
import re
from dataclasses import dataclass
from typing import Optional

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


class WorkspaceShellGuard:
    """工作区 Shell 执行前守卫：非代码项目工作区直接拒绝并导向 scratch；代码项目工作区走单次审批。"""

    def __init__(self, files: Optional[FileScope], default_exec_dir: Optional[str] = None) -> None:
        self._files = files
        self._default_exec_dir = default_exec_dir

    def _roots(self) -> tuple[Optional[str], Optional[str]]:
        if self._files is None:
            return None, None
        workspace = next((root.path for root in self._files.roots if root.kind is RootKind.WORKSPACE_FOLDER), None)
        scratch = next((root.path for root in self._files.roots if root.kind is RootKind.SESSION_WORKDIR), None)
        return workspace, scratch

    async def __call__(self, invocation: ToolInvocation) -> Optional[ToolResult]:
        if invocation.function_name != "shell_execute" or invocation.suspended:
            return None
        workspace_path, scratch_path = self._roots()
        if not workspace_path or not scratch_path:
            return None
        command = invocation.arguments.get("command")
        if not isinstance(command, str) or not command.strip():
            return None
        exec_dir = invocation.arguments.get("exec_dir")
        effective_dir = exec_dir if isinstance(exec_dir, str) and exec_dir.strip() else (self._default_exec_dir or scratch_path)
        risk = inspect_workspace_shell(command, effective_dir, workspace_path, scratch_path)
        if risk is None:
            return None
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
