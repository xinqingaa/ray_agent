"""只读核对工作树输入与网关提供的实际构建产物。"""
import json
import os
import subprocess
import sys
from pathlib import Path
from urllib.request import urlopen

root = Path(__file__).resolve().parents[1]
base = (sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8088').rstrip('/')
failed = False
for service, command, endpoint in (
    ('api', [sys.executable, 'build_identity.py'], '/api/status/build'),
    ('ui', ['node', 'scripts/build-identity.cjs'], '/build-manifest.json'),
):
    expected = json.loads(subprocess.check_output(command, cwd=root / service, env={**os.environ, 'NEXT_PUBLIC_API_BASE_URL': os.getenv('NEXT_PUBLIC_API_BASE_URL', '/api')}))
    try:
        with urlopen(base + endpoint, timeout=10) as response:
            actual = json.load(response)
        if service == 'api':
            actual = actual['data']
    except Exception as error:
        actual = {'status': 'unknown', 'error': str(error)}
    match = actual.get('fingerprint') == expected['fingerprint'] and actual.get('algorithm') == expected['algorithm']
    failed |= not match
    print(json.dumps(dict(service=service, matches=match, expected=expected, actual=actual), ensure_ascii=False))
sys.exit(1 if failed else 0)
