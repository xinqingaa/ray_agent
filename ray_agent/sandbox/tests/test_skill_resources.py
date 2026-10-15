import asyncio
import base64
import hashlib
import tempfile
import unittest
import uuid
from pathlib import Path
from app.services.skill_resources import prepare_resources
from app.core.skill_body_limit import SkillBodyLimit


class SkillResourcesTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name).resolve()
        self.run_id, self.version = str(uuid.uuid4()), 'a' * 64
        raw = b'original\n'
        self.file = {'path': 'references/note.txt', 'size': len(raw), 'sha256': hashlib.sha256(raw).hexdigest(), 'content': base64.b64encode(raw).decode()}

    def tearDown(self):
        self.temp.cleanup()

    def prepare(self, files):
        return prepare_resources(self.run_id, 'example', self.version, files, self.root)

    def test_publish_recheck_and_restore_modified_material(self):
        published = self.prepare([self.file])
        target = Path(published['root']) / self.file['path']
        target.write_bytes(b'changed')
        self.assertTrue(self.prepare([self.file])['verified'])
        self.assertEqual(target.read_bytes(), b'original\n')
        import shutil
        root = Path(published['root'])
        shutil.rmtree(root)
        root.write_text('modified root')
        self.assertTrue(self.prepare([self.file])['verified'])
        self.assertEqual(target.read_bytes(), b'original\n')

    def test_reject_escape_alias_symlink_and_hash_mismatch(self):
        for path in ('../escape', '/absolute', 'a/../../b', 'a\\b', 'NUL/data'):
            with self.assertRaises(ValueError): self.prepare([{**self.file, 'path': path}])
        with self.assertRaises(ValueError): self.prepare([self.file, {**self.file, 'path': 'REFERENCES/NOTE.TXT'}])
        with self.assertRaises(ValueError): self.prepare([{**self.file, 'sha256': 'b' * 64}])
        (self.root / self.run_id).symlink_to(self.root.parent, target_is_directory=True)
        with self.assertRaises(ValueError): self.prepare([self.file])

    def test_chunked_body_limit_runs_before_json_parsing(self):
        async def run():
            called, sent = [], []
            async def inner(scope, receive, send): called.append(True)
            chunks = iter([{'type': 'http.request', 'body': b'123', 'more_body': True}, {'type': 'http.request', 'body': b'456', 'more_body': False}])
            async def receive(): return next(chunks)
            async def send(item): sent.append(item)
            await SkillBodyLimit(inner, max_bytes=5)({'type': 'http', 'path': '/api/skills/prepare'}, receive, send)
            self.assertFalse(called)
            self.assertEqual(sent[0]['status'], 413)
        asyncio.run(run())


if __name__ == '__main__': unittest.main()
