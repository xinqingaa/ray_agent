"""Skill 多来源发现与目录包读取：只解释标准包，不执行 hooks 或自动安装依赖。"""
from __future__ import annotations

import hashlib
import os
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

from app.domain.services.skill_packages import SkillError, candidates, safe_path, validate_files

# 首批约定目录（相对用户主目录或工作区文件夹）
CONVENTION_RELATIVE = (
    ".agents/skills",
    ".codex/skills",
    ".claude/skills",
)

# 解析优先级：数字越小越优先
SOURCE_PRIORITY = {
    "workspace": 0,
    "user": 1,
    "extra": 2,
    "managed": 3,
    "builtin": 4,
}


@dataclass(frozen=True)
class SkillSourceSpec:
    """一次扫描范围：类型、稳定身份、展示标签与根路径。"""
    kind: str  # workspace | user | extra | managed | builtin
    source_id: str
    label: str
    root: Path | None = None  # managed/builtin 无外部根
    workspace_id: str | None = None
    enabled: bool = True


def skill_id_for(kind: str, canonical: str, name: str) -> str:
    """来源身份：同名不同来源不得共用；managed/builtin 仍用包名作 id。"""
    if kind in ("managed", "builtin"):
        return name
    digest = hashlib.sha256(f"{kind}\0{canonical}\0{name}".encode()).hexdigest()[:24]
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


def convention_sources(*, workspace_folder: str | None, workspace_id: str | None,
                       discover_user: bool, discover_workspace: bool,
                       extra_dirs: list[str], disabled_sources: set[str]) -> list[SkillSourceSpec]:
    """按计划顺序产出首批来源；禁用的来源仍列出但 enabled=False。"""
    result: list[SkillSourceSpec] = []
    if discover_workspace and workspace_folder and workspace_id:
        base = Path(workspace_folder)
        for relative in CONVENTION_RELATIVE:
            sid = source_id_for("workspace", relative=relative, workspace_id=workspace_id)
            result.append(SkillSourceSpec(
                kind="workspace", source_id=sid, label=f"工作区 · {relative}",
                root=base / relative, workspace_id=workspace_id,
                enabled=sid not in disabled_sources))
    if discover_user:
        home = user_home()
        for relative in CONVENTION_RELATIVE:
            sid = source_id_for("user", relative=relative)
            result.append(SkillSourceSpec(
                kind="user", source_id=sid, label=f"用户 · {relative}",
                root=home / relative, enabled=sid not in disabled_sources))
        # 显式 Codex 根：CODEX_HOME/skills，不硬编码开发者路径
        codex_home = os.environ.get("CODEX_HOME")
        if codex_home:
            root = Path(codex_home).expanduser().resolve() / "skills"
            sid = source_id_for("user", relative="codex-home/skills")
            result.append(SkillSourceSpec(
                kind="user", source_id=sid, label="用户 · CODEX_HOME/skills",
                root=root, enabled=sid not in disabled_sources))
    for path in extra_dirs:
        try:
            root = Path(path).expanduser().resolve()
        except OSError:
            continue
        sid = source_id_for("extra", path=str(root))
        result.append(SkillSourceSpec(
            kind="extra", source_id=sid, label=f"额外目录 · {root.name}",
            root=root, enabled=sid not in disabled_sources))
    return result


def _is_within(child: Path, root: Path) -> bool:
    try:
        child.resolve().relative_to(root.resolve())
        return True
    except (ValueError, OSError):
        return False


def read_package_dir(package_root: Path, settings) -> dict[str, bytes]:
    """读取外部 Skill 目录为包文件；包内链接仅在目标仍属包根时收录。"""
    root = package_root.resolve()
    if not root.is_dir() or root.is_symlink() and not root.exists():
        raise SkillError(f"Skill 目录不可用：{package_root}", 404)
    files: dict[str, bytes] = {}
    total = 0
    stack = [root]
    seen_dirs: set[Path] = set()
    while stack:
        current = stack.pop()
        try:
            resolved = current.resolve()
        except OSError as exc:
            raise SkillError(f"无法解析 Skill 路径：{exc}") from exc
        if resolved in seen_dirs:
            continue
        if not _is_within(resolved, root):
            raise SkillError("Skill 包外引用不被支持")
        seen_dirs.add(resolved)
        try:
            entries = list(current.iterdir())
        except OSError as exc:
            raise SkillError(f"无法读取 Skill 目录：{exc}") from exc
        for entry in entries:
            if entry.name in {".git", "node_modules", ".DS_Store"}:
                continue
            try:
                if entry.is_symlink():
                    target = entry.resolve()
                    if not _is_within(target, root):
                        raise SkillError(f"包内链接指向包外：{entry.name}")
                    if target.is_dir():
                        stack.append(entry)
                        continue
                    if not target.is_file():
                        raise SkillError(f"不支持的链接目标：{entry.name}")
                    rel = PurePosixPath(target.relative_to(root).as_posix())
                    data = target.read_bytes()
                elif entry.is_dir() and not entry.is_symlink():
                    stack.append(entry)
                    continue
                elif entry.is_file() and not entry.is_symlink():
                    rel = PurePosixPath(entry.relative_to(root).as_posix())
                    data = entry.read_bytes()
                else:
                    raise SkillError(f"不支持的特殊文件：{entry.name}")
            except SkillError:
                raise
            except OSError as exc:
                raise SkillError(f"读取 Skill 文件失败：{exc}") from exc
            path = safe_path(str(rel))
            if len(data) > settings.skill_file_bytes:
                raise SkillError(f"单文件大小超限：{path}")
            total += len(data)
            if total > settings.skill_package_bytes:
                raise SkillError("累计包大小超限")
            if len(files) >= settings.skill_max_files:
                raise SkillError("包文件数量超限")
            files[path] = data
    if "SKILL.md" not in files:
        raise SkillError("目录中没有 SKILL.md")
    return validate_files(files, settings)


def discover_packages(source: SkillSourceSpec, settings) -> list[dict]:
    """在来源根下一层子目录中寻找 SKILL.md；不递归整个工作区树。"""
    if source.root is None or not source.enabled:
        return []
    root = source.root
    if not root.exists():
        return []
    if root.is_symlink():
        try:
            root = root.resolve()
        except OSError:
            return [{"error": "来源软链接无法解析", "origin": str(source.root)}]
    if not root.is_dir():
        return [{"error": "来源不是目录", "origin": str(source.root)}]
    found: list[dict] = []
    packages: list[Path] = []
    if (root / "SKILL.md").is_file():
        packages.append(root)
    else:
        try:
            children = sorted(root.iterdir(), key=lambda p: p.name.casefold())
        except OSError as exc:
            return [{"error": f"无法扫描来源：{exc}", "origin": str(root)}]
        for child in children:
            if child.is_dir() and (child / "SKILL.md").exists():
                packages.append(child)
    for package_root in packages:
        origin = str(package_root)
        try:
            canonical = str(package_root.resolve())
        except OSError:
            found.append({"error": "无法解析规范路径", "origin": origin, "source_id": source.source_id})
            continue
        try:
            files = read_package_dir(package_root, settings)
            candidate = candidates(files, settings)[0]
        except SkillError as exc:
            found.append({
                "error": str(exc), "origin": origin, "canonical": canonical,
                "source_id": source.source_id, "kind": source.kind,
            })
            continue
        found.append({
            "name": candidate["name"],
            "description": candidate["description"],
            "version": candidate["version"],
            "files": candidate["files"],
            "warnings": candidate.get("warnings", []),
            "text": candidate["text"],
            "bundle": files,
            "origin": origin,
            "canonical": canonical,
            "source_id": source.source_id,
            "kind": source.kind,
            "label": source.label,
            "workspace_id": source.workspace_id,
            "id": skill_id_for(source.kind, canonical, candidate["name"]),
        })
    return found


def entry_kind(entry: dict) -> str:
    return entry.get("kind") or (entry.get("source") or {}).get("kind") or "managed"


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
    for relative in CONVENTION_RELATIVE:
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
