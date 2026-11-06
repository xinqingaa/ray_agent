#!/usr/bin/env python
# -*- coding: utf-8 -*-
import pytest
from fastapi.testclient import TestClient


@pytest.fixture(scope="session")
def client(tmp_path_factory) -> TestClient:
    """进入真实应用生命周期的客户端：数据根在 pytest 临时目录，不连接外部服务。"""
    import os
    from core.config import get_settings
    os.environ["RAYAGENT_DATA_ROOT"] = str(tmp_path_factory.mktemp("core-data"))
    get_settings.cache_clear()
    from app.main import app

    with TestClient(app) as c:
        yield c
