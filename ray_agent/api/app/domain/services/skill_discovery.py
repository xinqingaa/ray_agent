"""Skill 多来源发现与目录包读取：只解释标准包，不执行 hooks 或自动安装依赖。"""
from __future__ import annotations

import hashlib
import os
import stat
from collections import OrderedDict
from dataclasses import dataclass
from itertools import islice
from pathlib import Path
from typing import Callable

from app.domain.models.workspace import MARKER_DIRECTORY
from app.domain.services.skill_packages import SkillError, candidates, safe_path, validate_files

NATIVE_RELATIVE = f"{MARKER_DIRECTORY}/skills"
CONVENTION_RELATIVE = (".agents/skills", ".codex/skills", ".claude/skills", ".cursor/skills")
GROUPS = {
    "rayagent": "RayAgent",
    "agents": ".agents",
    "codex": ".codex",
    "claude": ".claude",
    "cursor": ".cursor",
    "extra": "额外目录",
}
SOURCE_PRIORITY = {"workspace": 0, "rayagent": 1, "user": 2, "extra": 3, "managed": 4, "builtin": 5}
SKIPPED = {".git", "node_modules", ".DS_Store"}


@dataclass(frozen=True)
class SkillSourceSpec:
    kind: str
    source_id: str
    label: str
    root: Path
    group: str
    workspace_id: str | None = None
    scope_root: Path | None = None
    enabled: bool = True
    instance_enabled: bool = True


def skill_id_for(kind: str, canonical: str, name: str) -> str:
    if kind in ("managed", "builtin"):
        return name
    digest = hashlib.sha256("\0".join((kind, canonical, name)).encode()).hexdigest()[:24]
    return f"ext-{kind}-{digest}"


def source_id_for(kind: str, relative: str | None = None, path: str | None = None,
                  workspace_id: str | None = None) -> str:
    if kind == "workspace":
        return f"workspace:{workspace_id}:{relative}"
    if kind == "user":
        return f"user:{relative}"
    if kind == "extra":
        digest = hashlib.sha256((path or "").encode()).hexdigest()[:16]
        return f"extra:{digest}"
    return kind


def user_home() -> Path:
    return Path(os.path.expanduser("~")).resolve()


def source_group(source_id: str) -> str:
    if source_id.startswith("extra:"):
        return "extra"
    if source_id == "rayagent" or source_id.endswith(f":{NATIVE_RELATIVE}"):
        return "rayagent"
    if source_id == "user:codex-home/skills":
        return "codex"
    return source_id.rsplit(":", 1)[-1].split("/", 1)[0].lstrip(".")


def convention_sources(*, workspace_folder: str | None, workspace_id: str | None,
                       global_folder: Path | None, config) -> list[SkillSourceSpec]:
    specs: list[SkillSourceSpec] = []
    disabled = set(config.disabled_sources)
    disabled_groups = set(config.disabled_groups)

    def add(kind, relative, base, label, allowed=True, wid=None, scope=None):
        sid = source_id_for(kind, relative, str(base), wid)
        group = source_group(sid)
        instance_enabled = allowed and sid not in disabled
        specs.append(SkillSourceSpec(
            kind, sid, label, base / relative, group, wid, scope,
            instance_enabled and group not in disabled_groups, instance_enabled,
        ))

    if workspace_folder and workspace_id:
        base = Path(workspace_folder)
        for relative in (NATIVE_RELATIVE, *CONVENTION_RELATIVE):
            add("workspace", relative, base, f"工作区 · {relative}",
                config.discover_workspace or relative == NATIVE_RELATIVE, workspace_id, base)
    if global_folder is not None:
        add("rayagent", NATIVE_RELATIVE, global_folder, "RayAgent 全局", scope=global_folder)
    home = user_home()
    for relative in CONVENTION_RELATIVE:
        add("user", relative, home, f"用户 · {relative}", config.discover_user)
    if codex_home := os.environ.get("CODEX_HOME"):
        base = Path(codex_home).expanduser()
        sid = source_id_for("user", "codex-home/skills")
        instance_enabled = config.discover_user and sid not in disabled
        specs.append(SkillSourceSpec("user", sid, "用户 · CODEX_HOME/skills", base / "skills",
                                     "codex", enabled=instance_enabled and "codex" not in disabled_groups,
                                     instance_enabled=instance_enabled))
    for path in config.extra_dirs:
        try:
            root = Path(path).expanduser().resolve()
        except (OSError, RuntimeError):
            continue
        add("extra", "", root, f"额外目录 · {root.name}")
    return specs


def _bounded_children(path: Path, limit: int) -> list[Path]:
    with os.scandir(path) as entries:
        children = [Path(e.path) for e in islice(entries, limit + 1)]
    if len(children) > limit:
        raise SkillError("扫描目录条目超过上限")
    return sorted(children, key=lambda p: (p.name.casefold(), p.name))


def _package_files(root: Path, settings):
    """有界地核对路径、文件类型、元数据和大小，未变化时可复用内容快照。"""
    pending = [(root, frozenset())]
    files = []
    total = visited = 0
    while pending:
        path, ancestors = pending.pop()
        target = path.resolve(strict=True)
        if not target.is_relative_to(root):
            raise SkillError(f"包内链接指向包外：{path.name}")
        if target in ancestors:
            raise SkillError(f"包内链接存在循环：{path.name}")
        info = target.stat()
        visited += 1
        if visited > settings.skill_discovery_max_entries:
            raise SkillError("包内目录条目超过上限")
        if stat.S_ISDIR(info.st_mode):
            children = _bounded_children(path, settings.skill_discovery_max_entries)
            pending.extend((child, ancestors | {target}) for child in reversed(children) if child.name not in SKIPPED)
            continue
        if not stat.S_ISREG(info.st_mode):
            raise SkillError(f"不支持的特殊文件：{path.name}")
        rel = safe_path(path.relative_to(root).as_posix())
        total += info.st_size
        if info.st_size > settings.skill_file_bytes or total > settings.skill_package_bytes:
            raise SkillError(f"包大小超限：{rel}")
        if len(files) >= settings.skill_max_files:
            raise SkillError("包文件数量超限")
        files.append((rel, target, (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)))
    return files


def _read_package_files(files, settings) -> dict[str, bytes]:
    bundle = {}
    for rel, target, stamp in files:
        descriptor = os.open(target, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(descriptor, "rb") as stream:
            info = os.fstat(stream.fileno())
            if not stat.S_ISREG(info.st_mode) or (
                info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns
            ) != stamp:
                raise SkillError(f"扫描时文件已变更：{rel}")
            data = stream.read(info.st_size + 1)
            if len(data) != info.st_size:
                raise SkillError(f"扫描时文件已变更：{rel}")
            bundle[rel] = data
    return validate_files(bundle, settings)


def read_package_dir(package_root: Path, settings) -> dict[str, bytes]:
    try:
        root = package_root.resolve(strict=True)
        if not root.is_dir():
            raise SkillError("Skill 包目录不可用")
        return _read_package_files(_package_files(root, settings), settings)
    except (OSError, RuntimeError) as exc:
        raise SkillError("无法读取 Skill 包目录") from exc


def _package_roots(source: SkillSourceSpec, settings) -> list[Path]:
    if not source.root.exists() and not source.root.is_symlink():
        return []
    root = source.root.resolve(strict=True)
    if source.scope_root is not None and not root.is_relative_to(source.scope_root.resolve(strict=True)):
        raise SkillError("Skill 来源链接指向工作区或 RayAgent 根之外")
    if not root.is_dir():
        raise SkillError("Skill 来源不是目录")
    depth_limit = settings.skill_discovery_max_depth if source.group == "cursor" else 1
    pending = [(source.root, 0, frozenset())]
    roots = []
    entries_left = settings.skill_discovery_max_entries
    while pending:
        folder, depth, ancestors = pending.pop()
        canonical = folder.resolve(strict=True)
        if canonical in ancestors:
            continue
        if (folder / "SKILL.md").is_file() or (folder / "SKILL.md").is_symlink():
            roots.append(folder)
            continue
        if depth >= depth_limit or (source.scope_root is not None and
                                   not canonical.is_relative_to(source.scope_root.resolve(strict=True))):
            continue
        children = _bounded_children(folder, entries_left)
        entries_left -= len(children)
        pending.extend((p, depth + 1, ancestors | {canonical})
                       for p in reversed(children) if p.name not in SKIPPED and not p.name.startswith(".") and p.is_dir())
    return roots


def discover_packages(source: SkillSourceSpec, settings, cache: OrderedDict, *,
                      publish: Callable[[str, dict], None], exists: Callable[[str], bool],
                      force: bool = False, foreign_roots: tuple[Path, ...] = ()) -> list[dict]:
    """每个包独立验证并发布，扫描结果只保留元数据。"""
    try:
        roots = _package_roots(source, settings)
    except (OSError, RuntimeError, SkillError) as exc:
        return [{"error": str(exc), "origin": str(source.root), "source_error": True}]
    found = []
    for package_root in roots:
        try:
            canonical = package_root.resolve(strict=True)
            if source.scope_root is not None and not canonical.is_relative_to(source.scope_root.resolve(strict=True)):
                raise SkillError("Skill 包链接指向授权根之外")
            if any(canonical.is_relative_to(root) for root in foreign_roots):
                raise SkillError("Skill 包属于其他工作区")
            inventory = _package_files(canonical, settings)
            fingerprint = tuple(inventory)
            cached = cache.get(canonical)
            if not force and cached and cached[0] == fingerprint and exists(cached[1]["version"]):
                candidate = cached[1]
                cache.move_to_end(canonical)
            else:
                files = _read_package_files(inventory, settings)
                candidate = candidates(files, settings)[0]
                publish(candidate["version"], files)
                cache[canonical] = (fingerprint, candidate)
                cache.move_to_end(canonical)
                while len(cache) > settings.skill_discovery_cache_entries:
                    cache.popitem(last=False)
            found.append({**candidate, "id": skill_id_for(source.kind, str(canonical), candidate["name"]),
                          "origin": str(package_root), "canonical": str(canonical)})
        except (SkillError, OSError, RuntimeError) as exc:
            found.append({"error": str(exc), "origin": str(package_root)})
    return found


def entry_kind(entry: dict) -> str:
    kind = entry.get("kind") or (entry.get("source") or {}).get("kind") or "managed"
    return "managed" if kind in ("github", "manual", "zip", "local") else kind


def entry_canonical(entry: dict) -> str:
    return entry.get("canonical") or (entry.get("source") or {}).get("canonical") or entry["id"]


def entry_workspace_id(entry: dict) -> str | None:
    """工作区 Skill 的工作区身份。身份本身可以含冒号，不能按分隔符切 source_id。"""
    source = entry.get("source") or {}
    explicit = source.get("workspace_id") or entry.get("workspace_id")
    if explicit:
        return explicit
    source_id = str(source.get("source_id") or "")
    if not source_id.startswith("workspace:"):
        return None
    rest = source_id[len("workspace:"):]
    for relative in (NATIVE_RELATIVE, *CONVENTION_RELATIVE):
        suffix = f":{relative}"
        if rest.endswith(suffix):
            return rest[: -len(suffix)]
    return None


def resolve_aliases(entries: list[dict]) -> list[dict]:
    """同一规范路径去重，保留优先级更高（数字更小）的来源。"""
    by_canonical: dict[str, dict] = {}
    for entry in entries:
        key = entry_canonical(entry)
        prior = by_canonical.get(key)
        if prior is None:
            by_canonical[key] = entry
            continue
        if SOURCE_PRIORITY.get(entry_kind(entry), 99) < SOURCE_PRIORITY.get(entry_kind(prior), 99):
            by_canonical[key] = entry
    return list(by_canonical.values())


def resolve_names(entries: list[dict], preferred: dict[str, str]) -> tuple[list[dict], list[dict]]:
    """按层解析同名；返回 (可自动启用的目录项, 冲突项)。preferred: name -> skill_id。"""
    by_name: dict[str, list[dict]] = {}
    for entry in entries:
        by_name.setdefault(entry["name"], []).append(entry)
    selected, conflicts = [], []
    for name, group in by_name.items():
        if len(group) == 1:
            selected.append(group[0])
            continue
        if name in preferred:
            choice = next((e for e in group if e["id"] == preferred[name]), None)
            if choice:
                selected.append(choice)
                continue
        layers: dict[int, list[dict]] = {}
        for entry in group:
            layers.setdefault(SOURCE_PRIORITY.get(entry_kind(entry), 99), []).append(entry)
        best_layer = min(layers)
        winners = layers[best_layer]
        if len(winners) == 1 and all(len(v) == 1 or k > best_layer for k, v in layers.items()):
            # 最高层唯一 → 采用；下层同名保留为冲突展示但不自动进目录
            selected.append(winners[0])
            for layer, items in layers.items():
                if layer != best_layer:
                    conflicts.extend(items)
        else:
            conflicts.extend(group)
    return selected, conflicts
