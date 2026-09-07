#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Docker Engine 29 起 NetworkSettings 不再提供顶层 IPAddress。"""
from types import SimpleNamespace

import pytest

from app.infrastructure.external.sandbox.docker_sandbox import DockerSandbox


def test_get_container_ip_from_networks_when_top_level_missing():
    container = SimpleNamespace(attrs={
        "NetworkSettings": {
            "Networks": {
                "manus-network": {"IPAddress": "172.18.0.9"},
            }
        }
    })
    assert DockerSandbox._get_container_ip(container) == "172.18.0.9"


def test_get_container_ip_prefers_top_level_when_present():
    container = SimpleNamespace(attrs={
        "NetworkSettings": {
            "IPAddress": "172.18.0.2",
            "Networks": {
                "manus-network": {"IPAddress": "172.18.0.9"},
            }
        }
    })
    assert DockerSandbox._get_container_ip(container) == "172.18.0.2"


def test_get_container_ip_raises_when_missing():
    container = SimpleNamespace(attrs={"NetworkSettings": {"Networks": {}}})
    with pytest.raises(Exception, match="无法从容器网络配置中解析 IP"):
        DockerSandbox._get_container_ip(container)
