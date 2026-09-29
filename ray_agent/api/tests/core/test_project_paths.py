#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""W10 路径校验：realpath → 允许根目录（按路径段）→ 存在 → 目录；项目内相对路径的越界与符号链接逃逸。"""
import os

import pytest
from pydantic import ValidationError

from app.domain.models.project import PathCheckReason
from app.domain.services.project_paths import (
    check_project_path,
    is_within,
    resolve_in_project,
    resolve_roots,
)
from core.config import Settings


@pytest.fixture
def layout(tmp_path):
    base = os.path.realpath(tmp_path)
    root = os.path.join(base, "roots", "proj")
    project = os.path.join(root, "app")
    os.makedirs(os.path.join(project, "src"))
    with open(os.path.join(project, "src", "main.py"), "w") as f:
        f.write("print('hi')\n")
    with open(os.path.join(root, "notes.txt"), "w") as f:
        f.write("x")
    # 与根目录前缀相同但不是同一段
    os.makedirs(os.path.join(base, "roots", "project", "other"))
    outside = os.path.join(base, "outside")
    os.makedirs(outside)
    with open(os.path.join(outside, "secret.txt"), "w") as f:
        f.write("secret")
    return {"base": base, "root": root, "project": project, "outside": outside, "roots": [root]}


def test_normal_directory_passes(layout):
    check = check_project_path(layout["project"], layout["roots"])
    assert check.ok
    assert check.real_path == layout["project"]
    assert check.root == layout["root"]


def test_root_itself_is_allowed(layout):
    assert check_project_path(layout["root"], layout["roots"]).ok


def test_outside_root(layout):
    check = check_project_path(layout["outside"], layout["roots"])
    assert not check.ok and check.reason == PathCheckReason.OUTSIDE_ROOTS


def test_dotdot_escape(layout):
    path = os.path.join(layout["project"], "..", "..", "..", "outside")
    check = check_project_path(path, layout["roots"])
    assert check.reason == PathCheckReason.OUTSIDE_ROOTS
    assert check.real_path == layout["outside"]


def test_symlink_to_outside_root(layout):
    link = os.path.join(layout["root"], "escape")
    os.symlink(layout["outside"], link)
    check = check_project_path(link, layout["roots"])
    assert check.reason == PathCheckReason.OUTSIDE_ROOTS


def test_symlink_inside_root_resolves(layout):
    link = os.path.join(layout["root"], "alias")
    os.symlink(layout["project"], link)
    check = check_project_path(link, layout["roots"])
    assert check.ok and check.real_path == layout["project"]


def test_not_found(layout):
    check = check_project_path(os.path.join(layout["root"], "missing"), layout["roots"])
    assert check.reason == PathCheckReason.NOT_FOUND


def test_outside_and_missing_reports_outside_first(layout):
    check = check_project_path(os.path.join(layout["outside"], "missing"), layout["roots"])
    assert check.reason == PathCheckReason.OUTSIDE_ROOTS


def test_file_is_not_directory(layout):
    check = check_project_path(os.path.join(layout["root"], "notes.txt"), layout["roots"])
    assert check.reason == PathCheckReason.NOT_DIRECTORY


def test_same_prefix_different_segment(layout):
    sibling = os.path.join(layout["base"], "roots", "project", "other")
    check = check_project_path(sibling, layout["roots"])
    assert check.reason == PathCheckReason.OUTSIDE_ROOTS
    assert not is_within("/a/project", "/a/proj")
    assert is_within("/a/proj/x", "/a/proj")
    assert is_within("/a/proj", "/a/proj")


def test_relative_and_invalid_inputs(layout):
    assert check_project_path("roots/proj", layout["roots"]).reason == PathCheckReason.INVALID_PATH
    assert check_project_path("", layout["roots"]).reason == PathCheckReason.INVALID_PATH
    assert check_project_path(layout["project"] + "\x00", layout["roots"]).reason == PathCheckReason.INVALID_PATH


def test_no_roots_disables(layout):
    assert check_project_path(layout["project"], []).reason == PathCheckReason.NO_ROOTS
    assert check_project_path(layout["project"], ["/"]).reason == PathCheckReason.NO_ROOTS


def test_in_project_ok(layout):
    check = resolve_in_project(layout["project"], "src/./main.py", layout["roots"], expect="file")
    assert check.ok and check.relative == "src/main.py"
    root_check = resolve_in_project(layout["project"], "", layout["roots"], expect="directory")
    assert root_check.ok and root_check.relative == ""


def test_in_project_dotdot_escape(layout):
    check = resolve_in_project(layout["project"], "src/../../notes.txt", layout["roots"])
    assert check.reason == PathCheckReason.ESCAPES_PROJECT


def test_in_project_absolute_rejected(layout):
    check = resolve_in_project(layout["project"], os.path.join(layout["project"], "src"), layout["roots"])
    assert check.reason == PathCheckReason.INVALID_PATH


def test_in_project_symlink_escape(layout):
    os.symlink(os.path.join(layout["outside"], "secret.txt"), os.path.join(layout["project"], "leak.txt"))
    os.symlink(layout["outside"], os.path.join(layout["project"], "leakdir"))
    # 即使目标仍在允许根目录内，只要离开项目也拒绝
    os.symlink(os.path.join(layout["root"], "notes.txt"), os.path.join(layout["project"], "sibling.txt"))
    for rel in ("leak.txt", "leakdir", "leakdir/secret.txt", "sibling.txt"):
        check = resolve_in_project(layout["project"], rel, layout["roots"])
        assert check.reason == PathCheckReason.ESCAPES_PROJECT, rel


def test_in_project_symlink_inside_allowed(layout):
    os.symlink("src", os.path.join(layout["project"], "code"))
    check = resolve_in_project(layout["project"], "code/main.py", layout["roots"], expect="file")
    assert check.ok and check.real_path == os.path.join(layout["project"], "src", "main.py")


def test_in_project_type_checks(layout):
    assert resolve_in_project(layout["project"], "src", layout["roots"], expect="file").reason == PathCheckReason.NOT_FILE
    assert resolve_in_project(layout["project"], "src/main.py", layout["roots"],
                              expect="directory").reason == PathCheckReason.NOT_DIRECTORY
    assert resolve_in_project(layout["project"], "nope", layout["roots"]).reason == PathCheckReason.NOT_FOUND


def test_in_project_rechecks_project_against_roots(layout):
    check = resolve_in_project(layout["outside"], "secret.txt", layout["roots"], expect="file")
    assert check.reason == PathCheckReason.OUTSIDE_ROOTS


def test_git_pathspec_mode(layout):
    # 已删除的文件不存在也可以交给 git；父目录经符号链接离开项目仍拒绝
    ok = resolve_in_project(layout["project"], "src/deleted.py", layout["roots"], must_exist=False)
    assert ok.ok and ok.relative == "src/deleted.py"
    os.symlink(layout["outside"], os.path.join(layout["project"], "leakdir"))
    bad = resolve_in_project(layout["project"], "leakdir/secret.txt", layout["roots"], must_exist=False)
    assert bad.reason == PathCheckReason.ESCAPES_PROJECT
    assert resolve_in_project(layout["project"], "../x", layout["roots"],
                              must_exist=False).reason == PathCheckReason.ESCAPES_PROJECT


def test_resolve_roots_marks_unavailable(layout):
    roots = resolve_roots([layout["root"], os.path.join(layout["base"], "missing"),
                           os.path.join(layout["root"], "notes.txt")])
    assert [r.available for r in roots] == [True, False, False]
    assert roots[1].reason == PathCheckReason.NOT_FOUND
    assert roots[2].reason == PathCheckReason.NOT_DIRECTORY


def test_settings_project_roots_parsing():
    settings = Settings(_env_file=None, project_roots=" /a/proj , ,/b/code,/a/proj ")
    assert settings.project_roots == ["/a/proj", "/b/code"]
    assert Settings(_env_file=None, project_roots="").project_roots == []
    with pytest.raises(ValidationError):
        Settings(_env_file=None, project_roots="relative/path")
    with pytest.raises(ValidationError):
        Settings(_env_file=None, project_roots="//")


def test_settings_project_roots_from_env(monkeypatch):
    monkeypatch.setenv("PROJECT_ROOTS", "/x/one,/x/two")
    assert Settings(_env_file=None).project_roots == ["/x/one", "/x/two"]
