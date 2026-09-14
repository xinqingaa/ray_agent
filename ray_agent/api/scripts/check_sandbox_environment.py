"""第十一章 Docker 观察；在可访问 Docker 和容器网络的 API 环境运行。"""
import asyncio
import json
from pathlib import Path
import sys
import uuid

import docker
from docker.errors import NotFound

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.infrastructure.external.sandbox.docker_sandbox import DockerSandbox
from core.config import get_settings


async def check():
    settings = get_settings()
    if settings.sandbox_address:
        raise RuntimeError("此观察只支持动态模式；不会修改已有沙箱配置")
    owned = []
    reconnected = None
    evidence = []
    client = docker.from_env()
    try:
        for _ in range(2):
            sandbox = await DockerSandbox.create()
            owned.append(sandbox)
            await asyncio.wait_for(sandbox.ensure_sandbox(), 90)
        first, second = owned
        path = "/tmp/lesson-11-" + uuid.uuid4().hex + ".txt"
        assert (await first.write_file(path, "hello-ch11")).success
        reconnected = await DockerSandbox.get(first.id)
        assert reconnected is not None
        result = await reconnected.read_file(path)
        assert result.success and result.data["content"] == "hello-ch11"
        other = await second.check_file_exists(path)
        assert other.success and other.data["exists"] is False
        evidence.append({"check": "reuse_and_separation", "containers": [x.id for x in owned],
                         "reconnected_content": result.data["content"], "second_has_file": False})
        command = "id -u"
        uid = await first.exec_command("lesson-11-id", "/tmp", command)
        assert uid.success and uid.data["returncode"] == 0
        # Only query the second disposable sandbox's status; no external destination.
        response = await first.exec_command("lesson-11-network", "/tmp",
            f"curl --noproxy '*' --fail --max-time 5 -s -o /dev/null -w '%{{http_code}}' http://{second._ip}:8080/api/supervisor/status")
        assert response.success and response.data["returncode"] == 0
        assert response.data["output"].strip() == "200"
        attrs = client.containers.get(first.id).attrs
        host = attrs["HostConfig"]
        evidence.append({"check": "runtime", "shell_uid": uid.data["output"].strip(),
                         "peer_http_status": 200, "memory_limit": host["Memory"],
                         "nano_cpus": host["NanoCpus"], "pids_limit": host.get("PidsLimit"),
                         "mount_count": len(attrs["Mounts"]), "auto_remove": host["AutoRemove"]})
    finally:
        if reconnected is not None:
            await reconnected.client.aclose()
        cleanup = []
        for sandbox in owned:
            removed = await sandbox.destroy()
            try:
                client.containers.get(sandbox.id)
            except NotFound:
                cleanup.append({"id": sandbox.id, "absent": True, "destroy_return": removed})
            else:
                raise RuntimeError(f"实验容器未回收: {sandbox.id}")
        client.close()
        evidence.append({"check": "explicit_cleanup", "containers": cleanup})
        print(json.dumps(evidence, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    asyncio.run(check())
