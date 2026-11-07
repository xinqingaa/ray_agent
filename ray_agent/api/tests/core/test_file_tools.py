"""模型文件工具：真实临时目录上的写入模式、文本编辑、搜索与列举，以及链接与特殊文件不被跟随。"""
import asyncio
import os

from app.domain.services.tools.file import FileTool
from tests.support.loop_harness import FileFixture


def run(coroutine):
    return asyncio.run(asyncio.wait_for(coroutine, 10))


def test_write_modes_edit_search_and_list():
    async def check():
        fx = FileFixture()
        tool = FileTool(fx.scope)
        created = await tool.write_file("notes/a.txt", "一\n二\n")
        assert created.success and created.data["created"] and fx.text("notes/a.txt") == "一\n二\n"
        assert (await tool.write_file("notes/a.txt", "三\n", append=True)).data["append"]
        assert fx.text("notes/a.txt") == "一\n二\n三\n"
        assert (await tool.write_file("notes/a.txt", "新", leading_newline=True, trailing_newline=True)).success
        assert fx.text("notes/a.txt") == "\n新\n"

        fx.put("code.py", "x = 1\nprint(x)\nx = 2\n")
        replaced = await tool.replace_in_file("code.py", "x =", "y =")
        assert replaced.data["replaced"] == 2 and fx.text("code.py") == "y = 1\nprint(x)\ny = 2\n"
        assert not (await tool.replace_in_file("code.py", "不存在", "z")).success
        assert not (await tool.replace_in_file("code.py", "", "z")).success
        found = await tool.search_in_file("code.py", r"y = \d")
        assert [m["line"] for m in found.data["matches"]] == [0, 2]
        window = await tool.read_file("code.py", start_line=1, end_line=2)
        assert window.data["content"] == "print(x)\n"

        (fx.root / "node_modules").mkdir()
        (fx.root / "node_modules" / "pkg.js").write_text("x")
        (fx.root / "sub").mkdir()
        (fx.root / "sub" / "deep.py").write_text("")
        listing = await tool.list_dir()
        assert {entry["name"] for entry in listing.data["entries"]} == {"notes", "code.py", "sub"}
        names = [entry for entry in (await tool.find_files(".", "**/*.py")).data["files"]]
        assert sorted(os.path.basename(str(name)) for name in names) == ["code.py", "deep.py"]
        assert not (await tool.read_file("missing.txt")).success
        assert not (await tool.read_file("notes")).success  # 目录不是文件
    run(check())


def test_binary_links_and_special_files_are_not_read_or_written(tmp_path):
    async def check():
        fx = FileFixture()
        tool = FileTool(fx.scope)
        fx.put("blob.bin", b"\x00\x01\xff\xfe")
        assert not (await tool.read_file("blob.bin")).success
        assert not (await tool.replace_in_file("blob.bin", "a", "b")).success
        secret = tmp_path / "secret.txt"
        secret.write_text("机密")
        (fx.root / "link.txt").symlink_to(secret)
        (fx.root / "dir_link").symlink_to(tmp_path, target_is_directory=True)
        assert not (await tool.read_file("link.txt")).success
        assert not (await tool.write_file("link.txt", "覆盖")).success and secret.read_text() == "机密"
        assert not (await tool.read_file("dir_link/secret.txt")).success
        assert not (await tool.write_file("dir_link/new.txt", "x")).success and not (tmp_path / "new.txt").exists()
        os.mkfifo(fx.root / "pipe")
        assert not (await tool.read_file("pipe")).success
        assert not (await tool.write_file("pipe", "x")).success
        assert not (await tool.read_file("../escape.txt")).success
    run(check())


def test_large_reads_are_capped_and_marked_truncated():
    async def check():
        fx = FileFixture()
        fx.put("big.txt", "".join(f"line {index}\n" for index in range(20000)))
        tool = FileTool(fx.scope)
        read = await tool.read_file("big.txt", max_length=100)
        assert read.success and read.data["truncated"] is True and len(read.data["content"]) <= 100 + 20
        tail = await tool.read_file("big.txt", start_line=19998, end_line=20000)
        assert tail.data["content"] == "line 19998\nline 19999\n" and tail.data["truncated"] is False
    run(check())
