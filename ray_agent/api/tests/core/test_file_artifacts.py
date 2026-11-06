"""文件交付与产物记录：保留真实运行器交付函数、交付工具与仓库过滤逻辑；文件在临时会话工作目录中，存储与数据库会话为替身。"""
import asyncio
import copy
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import UploadFile

from app.domain.models.event import MessageEvent
from app.domain.models.file import File
from app.domain.services.agent_task_runner import AgentTaskRunner
from app.domain.services.tools.deliver import DeliverTool
from app.infrastructure.external.workdir.session_workdir import SessionWorkdirs
from app.infrastructure.models import SessionModel
from app.infrastructure.repositories.db_session_repository import DBSessionRepository


class FileListSessionRepo:
    """用列表代替 JSON 列，保留 add_file / remove_file / get_file_by_path 的契约。"""

    def __init__(self):
        self.files = []
        self.removed = []

    async def add_file(self, session_id, file):
        self.files.append(file)

    async def remove_file(self, session_id, file_id):
        self.removed.append(file_id)
        self.files = [f for f in self.files if f.id != file_id]

    async def get_file_by_path(self, session_id, filepath):
        for file in reversed(self.files):
            if file.filepath == filepath:
                return file
        return None


class FakeStorage:
    """每次上传返回新对象，模拟内容对象按文件身份保存。"""

    def __init__(self):
        self.contents = []

    async def upload_file(self, upload_file: UploadFile, session_id=None) -> File:
        body = upload_file.file.read()
        self.contents.append(body)
        return File(id=f"file-{len(self.contents)}", filename=upload_file.filename, key=f"fi/file-{len(self.contents)}",
                    size=len(body), session_id=session_id)


def make_runner(tmp_path, storage):
    runner = AgentTaskRunner.__new__(AgentTaskRunner)
    runner._session_id = "lesson-12"
    workdirs = SessionWorkdirs(tmp_path)
    runner._workdir = workdirs.resolve(*workdirs.new_root("lesson-12")).ensure()
    runner._file_storage = storage
    repo = FileListSessionRepo()

    class FakeUow:
        def __init__(self):
            self.session = repo
            self.file = SimpleNamespace(save=AsyncMock())

        async def __aenter__(self):
            self.saved_files = copy.deepcopy(repo.files)
            return self

        async def __aexit__(self, exc_type, *args):
            if exc_type:
                repo.files = self.saved_files
            return False

    runner._uow_factory = FakeUow
    runner._uow = FakeUow()
    return runner, repo


def write(runner, name, content: bytes) -> str:
    path = runner._workdir.path / name
    path.write_bytes(content)
    return str(path)


def test_same_version_reuses_record_and_upload(tmp_path):
    async def run():
        runner, repo = make_runner(tmp_path, FakeStorage())
        path = write(runner, "draft.txt", b"v1")

        first = await runner._deliver_file(path)
        second = await runner._deliver_file(path)
        third = await runner._deliver_file("draft.txt")

        assert [f.id for f in repo.files] == [third.file.id]
        assert first.id == second.file.id == third.file.id
        assert second.reused and third.reused
        assert repo.removed == []
        assert third.file.filepath == path and first.session_id == "lesson-12"
        assert len(runner._file_storage.contents) == 1
        assert third.file.sha256 is not None

    asyncio.run(asyncio.wait_for(run(), 5))


def test_delivery_rejects_paths_outside_the_session_workdir(tmp_path):
    async def run():
        runner, repo = make_runner(tmp_path / "data", FakeStorage())
        outside = tmp_path / "outside.txt"
        outside.write_bytes(b"secret")
        (runner._workdir.path / "link.txt").symlink_to(outside)
        for path in (str(outside), "../../outside.txt", str(runner._workdir.path / "link.txt")):
            with pytest.raises(FileNotFoundError):
                await runner._deliver_file(path)
        assert repo.files == [] and runner._file_storage.contents == []

    asyncio.run(asyncio.wait_for(run(), 5))


class FakeDBSession:
    """只响应 remove_file 需要的按主键读取。"""

    def __init__(self, record):
        self._record = record

    async def get(self, model, key, **kwargs):
        return self._record

    async def flush(self):
        pass


def test_remove_file_filters_by_id_not_path():
    """仓库层契约：传入文件id移除对应记录，传入路径不会命中。"""

    async def run():
        record = SessionModel(
            id="lesson-12",
            files=[
                File(id="file-1", filepath="/a.txt").model_dump(mode="json"),
                File(id="file-2", filepath="/a.txt").model_dump(mode="json"),
            ],
            memories={},
        )
        repo = DBSessionRepository(FakeDBSession(record))

        await repo.remove_file("lesson-12", "file-1")
        assert [f["id"] for f in record.files] == ["file-2"]

        await repo.remove_file("lesson-12", "/a.txt")
        assert [f["id"] for f in record.files] == ["file-2"]

    asyncio.run(asyncio.wait_for(run(), 5))


@pytest.mark.parametrize("failure", ["upload", "association"])
def test_failed_replacement_keeps_previous_file(tmp_path, failure):
    async def run():
        runner, repo = make_runner(tmp_path, FakeStorage())
        path = write(runner, "a.txt", b"v1")
        first = await runner._deliver_file(path)
        write(runner, "a.txt", b"v2")
        if failure == "upload":
            runner._file_storage.upload_file = AsyncMock(side_effect=OSError("受控上传失败"))
        else:
            repo.add_file = AsyncMock(side_effect=RuntimeError("受控关联写入失败"))
        with pytest.raises((OSError, RuntimeError)):
            await runner._deliver_file(path)
        assert [f.id for f in repo.files] == [first.id]
    asyncio.run(asyncio.wait_for(run(), 5))


@pytest.mark.parametrize("fail_all", [True, False])
def test_delivery_failure_distinguishes_all_and_partial(tmp_path, fail_all):
    async def run():
        runner, repo = make_runner(tmp_path, FakeStorage())
        available = str(runner._workdir.path / "available.txt")
        if not fail_all:
            write(runner, "available.txt", b"available")
        tool = DeliverTool(runner._deliver_file)
        result = await tool.invoke("deliver_files", paths=[available, str(runner._workdir.path / "missing.txt")])
        assert result.success is False
        assert result.data.state == ('failed' if fail_all else 'partial')
        assert [item.success for item in result.data.items] == [not fail_all, False]
        assert "不存在" in result.data.items[1].error
        assert len(result.data.files) == (0 if fail_all else 1)
        assert [f.filepath for f in repo.files] == ([] if fail_all else [available])
    asyncio.run(asyncio.wait_for(run(), 5))


def test_new_version_preserves_current_and_historical_attachments(tmp_path):
    async def run():
        runner, repo = make_runner(tmp_path, FakeStorage())
        path = write(runner, "a.txt", b"v1")
        first = await runner._deliver_file(path)
        history = MessageEvent.model_validate_json(MessageEvent(attachments=[first]).model_dump_json())
        write(runner, "a.txt", b"v2")
        second = await runner._deliver_file(path)
        assert [f.id for f in repo.files] == [first.id, second.id]
        assert history.attachments[0].id == first.id
        assert runner._file_storage.contents == [b"v1", b"v2"]
    asyncio.run(asyncio.wait_for(run(), 5))


def test_existing_duplicate_records_are_not_a_migration(tmp_path):
    async def run():
        runner, repo = make_runner(tmp_path, FakeStorage())
        path = write(runner, "a.txt", b"v2")
        repo.files = [File(id="old1", filepath=path), File(id="old2", filepath=path)]
        new_file = await runner._deliver_file(path)
        assert [f.id for f in repo.files] == ["old1", "old2", new_file.id]
    asyncio.run(asyncio.wait_for(run(), 5))


def test_duplicate_paths_and_repeated_delivery_do_not_add_attachment_notices(tmp_path):
    async def check():
        runner, repo = make_runner(tmp_path, FakeStorage())
        path = write(runner, "a.txt", b"v1")
        tool = DeliverTool(runner._deliver_file)
        first = await tool.deliver_files([path, path])
        assert first.success and len(first.data.files) == 1 and first.data.items[1].reused
        again = await tool.deliver_files([path])
        assert again.data.items[0].reused and len(repo.files) == 1
        assert len(runner._file_storage.contents) == 1
    asyncio.run(asyncio.wait_for(check(), 5))
