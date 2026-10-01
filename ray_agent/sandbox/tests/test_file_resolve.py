"""沙箱实际路径契约；真实临时文件和链接，不启动 Docker。"""
import asyncio
import tempfile
import unittest
from pathlib import Path
from app.services.file import FileService


class FileResolveTests(unittest.TestCase):
    def test_resolves_parent_and_final_links_and_reports_regular_file(self):
        async def scenario():
            with tempfile.TemporaryDirectory() as temporary:
                root=Path(temporary);(root/'outside').mkdir();(root/'outside'/'report').write_bytes(b'answer')
                (root/'workspace').mkdir();(root/'workspace'/'link').symlink_to(root/'outside'/'report')
                (root/'linked-parent').symlink_to(root/'outside',target_is_directory=True)
                for path in (root/'workspace'/'link',root/'linked-parent'/'report'):
                    result=await FileService.check_file_exists(str(path))
                    self.assertTrue(result.exists and result.regular_file)
                    self.assertEqual(result.resolved_path,str((root/'outside'/'report').resolve()))
                directory=await FileService.check_file_exists(str(root/'outside'))
                self.assertTrue(directory.exists);self.assertFalse(directory.regular_file)
                missing=await FileService.check_file_exists(str(root/'missing'))
                self.assertFalse(missing.exists or missing.regular_file)
        asyncio.run(scenario())
