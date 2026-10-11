from pathlib import Path
import json
import subprocess

from build_identity import fingerprint


def test_api_fingerprint_tracks_inputs_and_excludes_runtime_secrets(tmp_path):
    (tmp_path / 'app').mkdir()
    code = tmp_path / 'app/example.py'
    code.write_text('a=1')
    first = fingerprint(tmp_path)
    (tmp_path / '.env').write_text('SECRET=do-not-hash')
    (tmp_path / 'config.yaml').write_text('private config')
    (tmp_path / 'README.md').write_text('docs')
    (tmp_path / 'app/__pycache__').mkdir()
    (tmp_path / 'app/__pycache__/cache.pyc').write_bytes(b'cache')
    assert fingerprint(tmp_path) == first
    code.write_text('a=2')
    assert fingerprint(tmp_path) != first


def test_ui_fingerprint_tracks_inputs_but_not_generated_manifest(tmp_path):
    script = Path(__file__).resolve().parents[3] / 'ui/scripts/build-identity.cjs'
    def value():
        return subprocess.check_output(['node', '-e', 'process.stdout.write(require(process.argv[1]).fingerprint(process.argv[2]))', str(script), str(tmp_path)], text=True)
    (tmp_path / 'public').mkdir()
    (tmp_path / 'src').mkdir()
    source = tmp_path / 'src/page.tsx'
    source.write_text('first')
    original = value()
    (tmp_path / 'public/build-manifest.json').write_text(json.dumps({'built_at':'changed'}))
    (tmp_path / '.env.local').write_text('private')
    (tmp_path / 'README.md').write_text('documentation')
    assert value() == original
    source.write_text('second')
    assert value() != original
