"""托管项目路径：拒绝词法逃逸、所有链接父目录与路径替换。"""
import os
import pytest
from app.domain.services.project_paths import normalize_relative, project_directory

@pytest.mark.parametrize('path', ['/tmp/a','../a','a/../b','a//b','a/./b','a\\b','bad\x00name'])
def test_invalid_relative_paths(path):
    assert normalize_relative(path) is None


def test_nfc_normalization_and_safe_parent(tmp_path):
    assert normalize_relative('cafe\u0301/file') == 'café/file'
    (tmp_path/'safe').mkdir()
    with project_directory(str(tmp_path),'safe') as fd:
        assert os.path.isdir(tmp_path/'safe')
        assert os.fstat(fd).st_ino == (tmp_path/'safe').stat().st_ino


def test_even_internal_symlink_parent_is_rejected(tmp_path):
    (tmp_path/'safe').mkdir()
    (tmp_path/'alias').symlink_to('safe', target_is_directory=True)
    with pytest.raises(OSError):
        with project_directory(str(tmp_path),'alias'):
            pass


def test_open_parent_descriptor_survives_path_replacement(tmp_path):
    (tmp_path/'safe').mkdir()
    (tmp_path/'safe'/'marker').write_text('safe')
    other=tmp_path/'other'; other.mkdir(); (other/'marker').write_text('secret')
    with project_directory(str(tmp_path),'safe') as fd:
        (tmp_path/'safe').rename(tmp_path/'old')
        (tmp_path/'safe').symlink_to(other, target_is_directory=True)
        file_fd=os.open('marker',os.O_RDONLY|os.O_NOFOLLOW,dir_fd=fd)
        try:
            assert os.read(file_fd,100)==b'safe'
        finally:
            os.close(file_fd)
