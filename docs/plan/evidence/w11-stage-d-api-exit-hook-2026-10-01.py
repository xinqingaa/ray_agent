"""Temporary phase-D test hook: only PID 1 and the pre-recorded project IDs."""
import json,os
from pathlib import Path
from app.infrastructure.external.project.snapshot_disk import SnapshotDisk
_original = SnapshotDisk._fault

def _scoped_exit(self, phase, path=''):
    _original(self, phase, path)
    if os.getpid() != 1:
        return
    try:
        scope = json.loads(Path('/tmp/rayagent-api-exit-scope.json').read_text())
    except FileNotFoundError:
        return
    project_id = self.root.parent.name
    if scope.get(project_id) != phase:
        return
    try:
        fd = os.open('/tmp/rayagent-api-exit-used-' + project_id, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError:
        return
    with os.fdopen(fd,'w') as marker:
        marker.write(json.dumps({'pid':os.getpid(),'phase':phase,'path':path,'project_id':project_id}))
        marker.flush();os.fsync(marker.fileno())
    print('SCOPED_API_EXIT ' + json.dumps({'pid':os.getpid(),'phase':phase,'project_id':project_id}),flush=True)
    os._exit(73)
SnapshotDisk._fault = _scoped_exit
