"""第十二章：文件同步与产物记录；保留真实运行器与仓库过滤逻辑，替换存储与数据库会话。"""
import asyncio
import io
import copy

import pytest
from types import SimpleNamespace
from unittest.mock import AsyncMock

from fastapi import UploadFile

from app.domain.models.event import MessageEvent, ErrorEvent
from app.domain.models.message import Message
from app.domain.models.file import File
from app.domain.services.agent_task_runner import AgentTaskRunner
from app.infrastructure.models import SessionModel
from app.infrastructure.repositories.db_session_repository import DBSessionRepository


class FileListSessionRepo:
    """用列表代替 JSONB 列，保留 add_file / remove_file / get_file_by_path 的契约。"""

    def __init__(self):
        self.files = []
        self.removed = []

    async def add_file(self, session_id, file):
        self.files.append(file)

    async def remove_file(self, session_id, file_id):
        self.removed.append(file_id)
        self.files = [f for f in self.files if f.id != file_id]

    async def get_file_by_path(self, session_id, filepath):
        for file in self.files:
            if file.filepath == filepath:
                return file
        return None


class FakeStorage:
    """每次上传返回新对象，模拟本地存储按 uuid 生成 key。"""

    def __init__(self):
        self.contents = []

    async def upload_file(self, upload_file: UploadFile) -> File:
        body = upload_file.file.read()
        self.contents.append(body)
        return File(
            id=f"file-{len(self.contents)}",
            filename=upload_file.filename,
            key=f"2026/09/14/file-{len(self.contents)}.txt",
            extension=".txt",
            size=len(body),
        )


def make_runner(session_id, sandbox, storage):
    runner = AgentTaskRunner.__new__(AgentTaskRunner)
    runner._session_id = session_id
    runner._sandbox = sandbox
    runner._file_storage = storage
    repo = FileListSessionRepo()

    class FakeUow:
        def __init__(self):
            self.session = repo

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


def test_same_path_sync_replaces_record_instead_of_accumulating():
    async def run():
        sandbox = SimpleNamespace(download_file=AsyncMock(side_effect=lambda _: io.BytesIO(b"v1")))
        runner, repo = make_runner("lesson-12", sandbox, FakeStorage())
        path = "/home/ubuntu/draft.txt"

        first = await runner._sync_file_to_storage(path)
        second = await runner._sync_file_to_storage(path)
        third = await runner._sync_file_to_storage(path)

        assert [f.id for f in repo.files] == [third.id]
        assert repo.removed == [first.id, second.id], "旧记录必须按文件id移除"
        assert third.filepath == path
        # 存储每次仍上传一份、不按内容去重；此处只断言未把去重误写成存储层保证。
        assert len(runner._file_storage.contents) == 3

    asyncio.run(asyncio.wait_for(run(), 5))


class FakeResult:
    def __init__(self, record):
        self._record = record

    def scalar_one_or_none(self):
        return self._record


class FakeDBSession:
    """只响应 remove_file 需要的 select(SessionModel)。"""

    def __init__(self, record):
        self._record = record

    async def execute(self, stmt):
        return FakeResult(self._record)

    async def flush(self):
        pass


def test_remove_file_filters_by_id_not_path():
    """仓库层契约：传入文件id移除对应记录，传入路径不会命中。"""

    async def run():
        record = SessionModel(
            id="lesson-12",
            title="",
            unread_message_count=0,
            latest_message="",
            events=[],
            files=[
                File(id="file-1", filepath="/a.txt").model_dump(mode="json"),
                File(id="file-2", filepath="/a.txt").model_dump(mode="json"),
            ],
            memories={},
            status="pending",
        )
        repo = DBSessionRepository(FakeDBSession(record))

        await repo.remove_file("lesson-12", "file-1")
        assert [f["id"] for f in record.files] == ["file-2"]

        # 修复前的调用方式传入的是路径，不应误删任何记录。
        await repo.remove_file("lesson-12", "/a.txt")
        assert [f["id"] for f in record.files] == ["file-2"]

    asyncio.run(asyncio.wait_for(run(), 5))


@pytest.mark.parametrize("failure", ["upload", "association"])
def test_failed_replacement_keeps_previous_file(failure):
    async def run():
        sandbox = SimpleNamespace(download_file=AsyncMock(side_effect=lambda _: io.BytesIO(b"v1")))
        runner, repo = make_runner("lesson-12", sandbox, FakeStorage())
        first = await runner._sync_file_to_storage("/a.txt")
        if failure == "upload":
            runner._file_storage.upload_file = AsyncMock(side_effect=OSError("受控上传失败"))
        else:
            repo.add_file = AsyncMock(side_effect=RuntimeError("受控关联写入失败"))
        assert await runner._sync_file_to_storage("/a.txt") is None
        assert [f.id for f in repo.files] == [first.id]
    asyncio.run(asyncio.wait_for(run(), 5))


@pytest.mark.parametrize("fail_all", [True, False])
def test_delivery_failure_distinguishes_all_and_partial(fail_all):
    async def run():
        async def download(path):
            if fail_all or path == "/missing.txt":
                raise FileNotFoundError(path)
            return io.BytesIO(b"available")
        runner, repo = make_runner("lesson-12", SimpleNamespace(download_file=download), FakeStorage())
        class Flow:
            async def invoke(self, message):
                yield MessageEvent(message="交付", attachments=[
                    File(filepath="/available.txt"), File(filepath="/missing.txt")])
        runner._flow = Flow()
        events = [e async for e in runner._run_flow(Message(message="任务"))]
        assert len(events[0].attachments) == (0 if fail_all else 1)
        assert any(isinstance(e, ErrorEvent) for e in events) == fail_all
    asyncio.run(asyncio.wait_for(run(), 5))


def test_current_list_replacement_does_not_rewrite_historical_attachment():
    async def run():
        sandbox = SimpleNamespace(download_file=AsyncMock(side_effect=[io.BytesIO(b"v1"), io.BytesIO(b"v2")]))
        runner, repo = make_runner("lesson-12", sandbox, FakeStorage())
        first = await runner._sync_file_to_storage("/a.txt")
        history = MessageEvent.model_validate_json(MessageEvent(attachments=[first]).model_dump_json())
        second = await runner._sync_file_to_storage("/a.txt")
        assert [f.id for f in repo.files] == [second.id]
        assert history.attachments[0].id == first.id
        assert runner._file_storage.contents == [b"v1", b"v2"]
    asyncio.run(asyncio.wait_for(run(), 5))


def test_existing_duplicate_records_are_not_a_migration():
    async def run():
        sandbox = SimpleNamespace(download_file=AsyncMock(side_effect=lambda _: io.BytesIO(b"v2")))
        runner, repo = make_runner("lesson-12", sandbox, FakeStorage())
        repo.files = [File(id="old1", filepath="/a.txt"), File(id="old2", filepath="/a.txt")]
        new_file = await runner._sync_file_to_storage("/a.txt")
        assert [f.id for f in repo.files] == ["old2", new_file.id]
    asyncio.run(asyncio.wait_for(run(), 5))
