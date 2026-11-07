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

