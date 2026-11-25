"""本机语音适配。进程独占模型内存，取消或超时后回收。"""
import asyncio
import logging
import os
import platform
import subprocess
import sys
import uuid
from contextlib import suppress
from pathlib import Path

from app.application.errors.exceptions import AppException
from app.domain.models.error import ErrorCode
from app.domain.models.voice import ASRResult
from core.paths import RESOURCE_ROOT

COMPONENT_ID = "whisper-asr"
MODEL_FILE = "ggml-small-q5_1.bin"
MODEL_ID = "whisper-small-q5_1"
EXECUTABLE = "rayagent-whisper"
MIN_MACOS_MAJOR = 14
TIMEOUT_SECONDS = 135
SLOTS = asyncio.Semaphore(1)
logger = logging.getLogger(__name__)


def executable_path() -> Path:
    directory = "voice" if getattr(sys, "frozen", False) else "build/voice"
    return RESOURCE_ROOT / directory / EXECUTABLE


def unavailable_reason() -> str | None:
    version = platform.mac_ver()[0].partition(".")[0]
    if (sys.platform != "darwin" or platform.machine() != "arm64"
            or not version.isdecimal() or int(version) < MIN_MACOS_MAJOR):
        return f"本机转写需要 Apple Silicon 和 macOS {MIN_MACOS_MAJOR} 或更新版本。"
    path = executable_path()
    if not path.is_file() or not os.access(path, os.X_OK):
        return "本机转写程序缺失，请使用完整的 RayAgent 应用。"
    return None


def is_transcribing() -> bool:
    return SLOTS.locked()


def verify_model(directory: Path) -> None:
    reason = unavailable_reason()
    if reason:
        raise RuntimeError(reason)
    result = subprocess.run([str(executable_path()), "--check-model", str(directory / MODEL_FILE)], check=False)
    if result.returncode:
        raise RuntimeError(f"本机转写程序无法加载模型（退出状态 {result.returncode}）")


async def transcribe(directory: Path, pcm: bytes, duration_ms: int) -> ASRResult:
    try:
        async with asyncio.timeout(TIMEOUT_SECONDS), SLOTS:
            process = await asyncio.create_subprocess_exec(
                str(executable_path()), str(directory / MODEL_FILE),
                stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
            )
            try:
                stdout, _ = await process.communicate(pcm)
            finally:
                if process.returncode is None:
                    with suppress(ProcessLookupError):
                        process.kill()
                    await process.wait()
    except TimeoutError:
        raise AppException(ErrorCode.TIMEOUT, "本机转写超时，请重试或缩短录音") from None
    except OSError as error:
        logger.warning("本机转写程序无法启动，errno=%s", error.errno)
        raise AppException(ErrorCode.UNAVAILABLE, "无法启动本机转写程序") from None
    if process.returncode:
        logger.warning("本机转写程序退出，status=%s", process.returncode)
        message = "无法读取本机语音模型，请重新下载" if process.returncode == 3 else "本机转写失败，请重试"
        raise AppException(ErrorCode.UNAVAILABLE, message)
    try:
        text = stdout.decode("utf-8").strip()
    except UnicodeDecodeError:
        raise AppException(ErrorCode.UNAVAILABLE, "无法读取本机转写结果") from None
    return ASRResult(request_id=str(uuid.uuid4()), text=text, duration_ms=duration_ms)
