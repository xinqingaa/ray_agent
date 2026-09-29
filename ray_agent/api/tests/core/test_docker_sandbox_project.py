#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""W10 沙箱绑定项目（mock docker client）：有项目时 bind 挂载到 /workspace 读写，无项目时没有挂载，共享沙箱模式报错。"""
import asyncio
import os
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from app.domain.external.sandbox import SandboxProjectBindingError
from app.domain.models.project import PathCheckReason, ProjectPathError
from app.infrastructure.external.sandbox import docker_sandbox as module
from app.infrastructure.external.sandbox.docker_sandbox import DockerSandbox
from core.config import Settings


def make_settings(**overrides):
    values = dict(
        sandbox_address=None,
        sandbox_image="manus-sandbox",
        sandbox_name_prefix="rayagent-sandbox",
        sandbox_network="manus-network",
        project_roots=[],
    )
    values.update(overrides)
    return Settings(_env_file=None, **values)


@pytest.fixture
def docker_client(monkeypatch):
    container = MagicMock()
    container.attrs = {"NetworkSettings": {"Networks": {"manus-network": {"IPAddress": "172.18.0.9"}}}}
    client = MagicMock()
    client.containers.run.return_value = container
    monkeypatch.setattr(module.docker, "from_env", lambda: client)
    return client


def use_settings(monkeypatch, settings):
    monkeypatch.setattr(module, "get_settings", lambda: settings)


@pytest.fixture
def project(tmp_path):
    root = os.path.join(os.path.realpath(tmp_path), "root")
    proj = os.path.join(root, "proj")
    os.makedirs(proj)
    return SimpleNamespace(root=root, proj=proj)


def test_create_without_project_has_no_mounts(monkeypatch, docker_client):
    use_settings(monkeypatch, make_settings())
    sandbox = asyncio.run(DockerSandbox.create())
    config = docker_client.containers.run.call_args.kwargs
    assert "mounts" not in config and "volumes" not in config
    assert config["image"] == "manus-sandbox" and config["network"] == "manus-network"
    assert sandbox.id.startswith("rayagent-sandbox-")


def test_create_with_project_binds_workspace_rw(monkeypatch, docker_client, project):
    use_settings(monkeypatch, make_settings(project_roots=[project.root]))
    asyncio.run(DockerSandbox.create(project_path=project.proj + "/"))
    mounts = docker_client.containers.run.call_args.kwargs["mounts"]
    assert len(mounts) == 1
    mount = mounts[0]
    assert mount["Type"] == "bind"
    assert mount["Source"] == project.proj
    assert mount["Target"] == "/workspace"
    assert mount["ReadOnly"] is False


def test_create_with_project_revalidates_against_roots(monkeypatch, docker_client, project, tmp_path):
    outside = os.path.join(os.path.realpath(tmp_path), "outside")
    os.makedirs(outside)
    use_settings(monkeypatch, make_settings(project_roots=[project.root]))
    with pytest.raises(ProjectPathError) as exc:
        asyncio.run(DockerSandbox.create(project_path=outside))
    assert exc.value.reason == PathCheckReason.OUTSIDE_ROOTS

    use_settings(monkeypatch, make_settings())
    with pytest.raises(ProjectPathError) as exc:
        asyncio.run(DockerSandbox.create(project_path=project.proj))
    assert exc.value.reason == PathCheckReason.NO_ROOTS
    docker_client.containers.run.assert_not_called()


def test_shared_sandbox_rejects_project(monkeypatch, docker_client, project):
    use_settings(monkeypatch, make_settings(sandbox_address="127.0.0.1", project_roots=[project.root]))
    with pytest.raises(SandboxProjectBindingError, match="共享沙箱模式"):
        asyncio.run(DockerSandbox.create(project_path=project.proj))
    docker_client.containers.run.assert_not_called()

    sandbox = asyncio.run(DockerSandbox.create())
    assert sandbox.cdp_url == "http://127.0.0.1:9222"
    docker_client.containers.run.assert_not_called()
