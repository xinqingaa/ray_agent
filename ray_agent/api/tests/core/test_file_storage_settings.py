#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""文件存储后端配置与本地路径校验。"""
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.infrastructure.external.file_storage.local_file_storage import LocalFileStorage
from core.config import Settings


def test_file_storage_defaults_to_local():
    settings = Settings(_env_file=None)
    assert settings.file_storage_backend == "local"
    assert settings.file_storage_local_dir == "data/files"
    assert settings.sqlalchemy_echo is False


def test_sqlalchemy_echo_can_be_enabled():
    settings = Settings(_env_file=None, sqlalchemy_echo=True)
    assert settings.sqlalchemy_echo is True


def test_empty_file_storage_backend_falls_back_to_local():
    settings = Settings(_env_file=None, file_storage_backend="  ")
    assert settings.file_storage_backend == "local"


def test_cos_backend_requires_credentials():
    with pytest.raises(ValidationError, match="FILE_STORAGE_BACKEND=cos"):
        Settings(_env_file=None, file_storage_backend="cos")


def test_cos_backend_accepts_complete_credentials():
    settings = Settings(
        _env_file=None,
        file_storage_backend="COS",
        cos_secret_id="id",
        cos_secret_key="key",
        cos_region="ap-guangzhou",
        cos_bucket="demo-bucket",
    )
    assert settings.file_storage_backend == "cos"


def test_local_storage_rejects_path_traversal(tmp_path: Path):
    storage = LocalFileStorage(root_dir=str(tmp_path), uow_factory=lambda: None)
    with pytest.raises(ValueError, match="非法的文件存储路径"):
        storage._resolve_key_path("../secret.txt")
