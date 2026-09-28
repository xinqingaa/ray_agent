"""动态沙箱观察：分离、执行身份、资源上限与 TTL。在可访问 Docker 和容器网络的 API 环境运行。"""
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
        identity_cmd = r"""
printf 'user=%s\n' "$(id -un)"
printf 'uid=%s\n' "$(id -u)"
printf 'home=%s\n' "$HOME"
printf 'pwd=%s\n' "$(pwd)"
printf 'python=%s\n' "$(python3 --version 2>&1)"
printf 'node=%s\n' "$(node --version 2>&1)"
echo '---procs---'
ps -eo user=,args=
echo '---env---'
pid=$(ps -eo pid=,args= | awk '/uvicorn app.main:app/ && $0 !~ /awk/ {print $1; exit}')
printf 'uvicorn_pid=%s\n' "$pid"
if [ -n "$pid" ]; then tr '\0' '\n' < "/proc/$pid/environ" | grep -E '^(SERVER_TIMEOUT_MINUTES|SERVICE_TIMEOUT_MINUTES|HOME)=' || true; fi
"""
        identity = await first.exec_command("w7-identity", "/home/ubuntu", identity_cmd)
        assert identity.success and identity.data["returncode"] == 0, identity.message
        identity_text = identity.data["output"]
        fields = {}
        for line in identity_text.splitlines():
            if line.startswith("---"):
                break
            if "=" in line:
                key, value = line.split("=", 1)
                fields[key] = value
        assert fields.get("user") == "ubuntu", fields
        assert fields.get("home") == "/home/ubuntu", fields
        assert fields.get("pwd") == "/home/ubuntu", fields
        assert fields.get("python", "").startswith("Python 3.10"), fields
        assert fields.get("node", "").startswith("v24."), fields

        def users_running(fragment: str) -> set:
            found = set()
            in_procs = False
            for line in identity_text.splitlines():
                if line.strip() == "---procs---":
                    in_procs = True
                    continue
                if line.strip() == "---env---":
                    break
                if not in_procs or fragment not in line:
                    continue
                found.add(line.split(None, 1)[0])
            return found

        service_users = {
            "uvicorn": users_running("uvicorn app.main:app"),
            "chromium": users_running("chromium"),
            "Xvfb": users_running("Xvfb"),
            "x11vnc": users_running("x11vnc"),
            "socat": users_running("socat"),
            "websockify": users_running("websockify"),
        }
        for name, users in service_users.items():
            assert users == {"ubuntu"}, {name: users, "output": identity_text}
        env_lines = []
        in_env = False
        for line in identity_text.splitlines():
            if line.strip() == "---env---":
                in_env = True
                continue
            if in_env:
                env_lines.append(line)
        process_env = dict(item.split("=", 1) for item in env_lines if "=" in item and not item.startswith("uvicorn_pid="))
        assert process_env.get("HOME") == "/home/ubuntu", env_lines
        assert process_env.get("SERVER_TIMEOUT_MINUTES") == str(settings.sandbox_ttl_minutes), env_lines
        assert not any(line.startswith("SERVICE_TIMEOUT_MINUTES=") for line in env_lines), env_lines

        upload_path = "/home/ubuntu/upload/w7-owner.txt"
        output_path = "/home/ubuntu/.rayagent/outputs/w7-owner.txt"
        assert (await first.write_file(upload_path, "upload")).success
        assert (await first.write_file(output_path, "output")).success
        owner_result = await first.exec_command(
            "w7-owner",
            "/home/ubuntu",
            "stat -c '%U %n' /home/ubuntu/upload /home/ubuntu/.rayagent/outputs "
            f"{upload_path} {output_path}",
        )
        assert owner_result.success and owner_result.data["returncode"] == 0, owner_result.message
        owner_lines = [line for line in owner_result.data["output"].splitlines() if line.strip()]
        assert owner_lines and all(line.startswith("ubuntu ") for line in owner_lines), owner_lines

        # Only query the second disposable sandbox's status; no external destination.
        response = await first.exec_command("lesson-11-network", "/tmp",
            f"curl --noproxy '*' --fail --max-time 5 -s -o /dev/null -w '%{{http_code}}' http://{second._ip}:8080/api/supervisor/status")
        assert response.success and response.data["returncode"] == 0
        assert response.data["output"].strip() == "200"
        timeout_resp = await first.client.get(f"{first._base_url}/api/supervisor/timeout-status")
        timeout_resp.raise_for_status()
        timeout_body = timeout_resp.json()
        timeout_data = timeout_body.get("data") or {}
        assert timeout_data.get("active") is True, timeout_body
        remaining = float(timeout_data.get("remaining_seconds") or 0)
        assert remaining > 0, timeout_body
        attrs = client.containers.get(first.id).attrs
        host = attrs["HostConfig"]
        container_env = {}
        for item in attrs.get("Config", {}).get("Env") or []:
            if "=" in item:
                key, value = item.split("=", 1)
                container_env[key] = value
        expected_memory = int(settings.sandbox_memory_mb) * 1024 * 1024
        expected_nano = int(round(float(settings.sandbox_cpus) * 1_000_000_000))
        expected_pids = int(settings.sandbox_pids_limit)
        assert host["Memory"] == expected_memory, host["Memory"]
        assert host.get("MemorySwap") == expected_memory, host.get("MemorySwap")
        assert host["NanoCpus"] == expected_nano, host["NanoCpus"]
        assert host.get("PidsLimit") == expected_pids, host.get("PidsLimit")
        assert container_env.get("SERVER_TIMEOUT_MINUTES") == str(settings.sandbox_ttl_minutes), container_env
        assert "SERVICE_TIMEOUT_MINUTES" not in container_env
        evidence.append({
            "check": "runtime",
            "user": fields.get("user"),
            "uid": fields.get("uid"),
            "home": fields.get("home"),
            "pwd": fields.get("pwd"),
            "python": fields.get("python"),
            "node": fields.get("node"),
            "service_users": {name: sorted(users) for name, users in service_users.items()},
            "owners": owner_lines,
            "process_timeout_env": process_env.get("SERVER_TIMEOUT_MINUTES"),
            "peer_http_status": 200,
            "timeout_active": True,
            "timeout_remaining_seconds": remaining,
            "memory_limit": host["Memory"],
            "memory_swap": host.get("MemorySwap"),
            "nano_cpus": host["NanoCpus"],
            "pids_limit": host.get("PidsLimit"),
            "ttl_env": container_env.get("SERVER_TIMEOUT_MINUTES"),
            "mount_count": len(attrs["Mounts"]),
            "auto_remove": host["AutoRemove"],
        })
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
