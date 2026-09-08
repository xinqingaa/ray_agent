#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
@Time    : 2025/5/26 11:07
@Author  : thezehui@gmail.com
@File    : 6_9_mcp-code.py
"""
import os
import subprocess
import tempfile
import uuid
from pathlib import Path

from mcp.server import MCPServer
from mcp.server.transport_security import TransportSecuritySettings

mcp = MCPServer(name="MCP 2.2 代码解释器", version="1.0")
BASE_DIR = Path(os.getenv(
    "MCP_CODE_DIR",
    str(Path(tempfile.gettempdir()) / "ray-agent-mcp-code"),
))
UV_CMD = "uv"


@mcp.tool()
async def run_code(language: str, code: str, timeout: int = 30) -> str:
    """根据语言运行代码并返回执行结果，临时文件写入 MCP_CODE_DIR。

    Args:
        language: 'python' 或者 'node'
        code: 要执行的代码文本
        timeout: 最长运行描述（默认为30s）

    Returns:
        执行输出(stdout)或错误信息(stderr/异常)
    """
    # 1.检查传递的编程语言是否符合规则
    language = (language or "").strip().lower()
    if language not in ("python", "node"):
        return f"不支持的语言: {language}"

    # 2.计算获取临时代码文件名
    suffix = ".py" if language == "python" else ".js"
    name = f"temp_{uuid.uuid4().hex}{suffix}"
    tmp_path = BASE_DIR / name

    # 3.确保目录存在
    BASE_DIR.mkdir(parents=True, exist_ok=True)

    try:
        # 4.写入临时文件
        with open(tmp_path, "w", encoding="utf-8") as f:
            f.write(code)

        # 5.判断不同的语言类型执行不同的操作
        cwd = BASE_DIR
        if language == "python":
            # 6.使用uv来运行对应的文件
            cmd = [UV_CMD, "--directory", str(BASE_DIR), "run", name]
        else:
            # 7.使用node命令运行脚本
            cmd = ["node", str(tmp_path)]

        # 8.调用子线程运行对应命令
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            cwd=str(cwd),
        )

        # 9.获取输出与错误结果
        stdout = proc.stdout.strip()
        stderr = proc.stderr.strip()

        # 10.判断状态码
        if proc.returncode == 0:
            return stdout
        else:
            return f"命令返回非零状态 {proc.returncode}, stderr: \n{stderr or stdout}"
    except subprocess.TimeoutExpired:
        return f"执行超时(>{timeout}s)"
    except FileNotFoundError as e:
        return f"命令未找到活路径错误: {str(e)}"
    except Exception as e:
        return f"执行异常: {str(e)}"
    finally:
        # 尝试删除临时文件（并且忽略错误）
        try:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
        except Exception:
            pass


if __name__ == "__main__":
    mcp.run(
        transport="streamable-http",
        host="127.0.0.1",
        port=9888,
        transport_security=TransportSecuritySettings(
            enable_dns_rebinding_protection=False
        ),
    )
