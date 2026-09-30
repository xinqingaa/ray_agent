"""文件浏览不读取链接目标或阻塞特殊文件，保留文本/二进制/截断与分页验证。"""
import asyncio
import os
import pytest
from app.infrastructure.external.project.local_project_files import LocalProjectFiles
from app.domain.models.project import ProjectPathError


def test_tree_and_preview_never_follow_links(tmp_path):
    (tmp_path/'dir').mkdir(); (tmp_path/'dir'/'file').write_text('inside')
    (tmp_path/'link').symlink_to('dir', target_is_directory=True)
    secret=tmp_path.parent/(tmp_path.name+'-secret'); secret.write_text('private')
    try:
        (tmp_path/'outside').symlink_to(secret)
        files=LocalProjectFiles()
        listing=files.list_directory_sync(str(tmp_path))
        assert {e.name:e.type for e in listing.entries}=={'dir':'directory','link':'symlink','outside':'symlink'}
        assert files.read_file_sync(str(tmp_path),'outside').content==str(secret)
        assert files.read_file_sync(str(tmp_path),'outside').kind=='symlink'
        with pytest.raises(ProjectPathError):
            files.read_file_sync(str(tmp_path),'link/file')
    finally:
        secret.unlink()


def test_tree_truncation_and_file_kinds(tmp_path):
    (tmp_path/'text').write_text('hello')
    (tmp_path/'binary').write_bytes(b'hello\x00')
    (tmp_path/'big').write_bytes(b'x'*30)
    os.mkfifo(tmp_path/'fifo')
    files=LocalProjectFiles(entry_limit=2,max_file_bytes=20)
    assert files.list_directory_sync(str(tmp_path)).truncated
    assert files.read_file_sync(str(tmp_path),'text').content=='hello'
    assert files.read_file_sync(str(tmp_path),'binary').kind=='binary'
    assert files.read_file_sync(str(tmp_path),'big').kind=='too_large'
    assert files.read_file_sync(str(tmp_path),'fifo').kind=='other'
    assert asyncio.run(files.read_file(str(tmp_path),'text')).content=='hello'


@pytest.mark.parametrize('path',['../secret','/etc/passwd','a/../../secret'])
def test_escape_rejected(tmp_path,path):
    with pytest.raises(ProjectPathError):
        LocalProjectFiles().read_file_sync(str(tmp_path),path)
