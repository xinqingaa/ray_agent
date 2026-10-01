import io
import os
import zipfile
import pytest
from app.infrastructure.external.project.file_io import ProjectFileIO
from app.infrastructure.external.project.download import stream_file, stream_zip


def test_streaming_zip_and_file_skip_links_and_special_files(tmp_path):
    store = ProjectFileIO(tmp_path)
    contents = {'原料.csv': b'a,b\n1,2\n', 'nested/large': os.urandom(3 * 1024 * 1024)}
    for path, data in contents.items():
        store.publish(path, io.BytesIO(data))
    os.symlink('/etc/passwd', tmp_path/'secret')
    os.symlink(tmp_path/'nested', tmp_path/'linkdir')
    os.mkfifo(tmp_path/'fifo')
    output = list(stream_zip(store, list(store.walk()), 4 * 1024 * 1024))
    assert len(output) > 3 and max(map(len, output)) < 2 * 1024 * 1024
    with zipfile.ZipFile(io.BytesIO(b''.join(output))) as archive:
        assert set(archive.namelist()) == set(contents)
        for path, data in contents.items():
            assert archive.read(path) == data
            assert b''.join(stream_file(store, path)) == data
    with pytest.raises(OSError):
        b''.join(stream_file(store, 'linkdir/large'))
    with pytest.raises(ValueError, match='普通文件'):
        b''.join(stream_file(store, 'fifo'))


def test_zip_actual_growth_limit_and_final_symlink_recheck(tmp_path):
    store = ProjectFileIO(tmp_path); store.publish('file', io.BytesIO(b'original'))
    entries = list(store.walk())
    store.publish('file', io.BytesIO(b'longer contents'), overwrite=True)
    with pytest.raises(ValueError, match='上限'):
        b''.join(stream_zip(store, entries, 8))
    (tmp_path/'file').unlink(); os.symlink('/etc/passwd', tmp_path/'file')
    with pytest.raises(OSError):
        b''.join(stream_zip(store, entries, 1000))


def test_download_head_checks_headers_without_consuming_stream():
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from app.interfaces.endpoints.project_routes import router
    from app.interfaces.service_dependencies import get_project_file_service
    consumed = []
    class Files:
        async def download(self, project_id, path):
            assert project_id == 'project' and path == 'source.csv'
            def stream():
                consumed.append(True)
                yield b'category,amount\nA,10\n'
            return stream(), '材料.csv', 'application/octet-stream', '打包跳过链接'
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_project_file_service] = lambda: Files()
    with TestClient(app) as client:
        head = client.head('/projects/project/download?path=source.csv')
        assert head.status_code == 200 and not head.content and consumed == []
        result = client.get('/projects/project/download?path=source.csv')
    assert result.content == b'category,amount\nA,10\n' and consumed == [True]
    for name in ['content-disposition', 'content-type', 'x-rayagent-download-warning']:
        assert head.headers[name] == result.headers[name]
