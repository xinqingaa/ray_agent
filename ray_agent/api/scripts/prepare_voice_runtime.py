"""构建签名的 arm64 语音转写程序，模型由应用另行准备。"""
import asyncio
import shutil
import subprocess
import sys
import tarfile
from pathlib import Path

API_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(API_ROOT))
from app.infrastructure.external.components.install_files import fetch_file, sha256_file  # noqa: E402
from app.infrastructure.external.voice.whisper import EXECUTABLE, MIN_MACOS_MAJOR  # noqa: E402

WHISPER_VERSION = "1.8.3"
ARCHIVE_URL = f"https://codeload.github.com/ggml-org/whisper.cpp/tar.gz/refs/tags/v{WHISPER_VERSION}"
ARCHIVE_SHA256 = "870ba21409cdf66697dc4db15ebdb13bc67037d76c7cc63756c81471d8f1731a"
MODEL_LICENSE_URL = "https://raw.githubusercontent.com/openai/whisper/31243bad24cc746f07d4c8bfdd2d974872cb1803/LICENSE"
MODEL_LICENSE_SHA256 = "b5d65a59060e68c4ff940e1eddfa6f94b2d68fdf58ed7f4dd57721c997e35e9d"


def prepare() -> None:
    cache = API_ROOT / "build/voice-sources"
    archive = cache / f"whisper-v{WHISPER_VERSION}.tar.gz"
    if not archive.is_file() or sha256_file(archive) != ARCHIVE_SHA256:
        asyncio.run(fetch_file(ARCHIVE_URL, archive, expected_sha256=ARCHIVE_SHA256))
    source = cache / f"whisper.cpp-{WHISPER_VERSION}"
    if not (source / "CMakeLists.txt").exists():
        with tarfile.open(archive) as bundle:
            bundle.extractall(cache, filter="data")

    build = API_ROOT / "build/voice-native" / WHISPER_VERSION
    subprocess.run([
        "cmake", "-S", str(API_ROOT / "native/voice"), "-B", str(build),
        "-DCMAKE_BUILD_TYPE=Release", "-DCMAKE_OSX_ARCHITECTURES=arm64",
        f"-DCMAKE_OSX_DEPLOYMENT_TARGET={MIN_MACOS_MAJOR}.0", f"-DWHISPER_SOURCE_DIR={source}",
    ], check=True)
    subprocess.run(["cmake", "--build", str(build), "--target", EXECUTABLE, "--parallel"], check=True)

    target = API_ROOT / "build/voice"
    target.mkdir(parents=True, exist_ok=True)
    model_license = target / "LICENSE-OpenAI-Whisper"
    if not model_license.is_file() or sha256_file(model_license) != MODEL_LICENSE_SHA256:
        asyncio.run(fetch_file(MODEL_LICENSE_URL, model_license, expected_sha256=MODEL_LICENSE_SHA256))
    shutil.copyfile(source / "LICENSE", target / "LICENSE-whisper.cpp")
    pending = target / f".{EXECUTABLE}.new"
    try:
        shutil.copy2(build / EXECUTABLE, pending)
        subprocess.run(["codesign", "--force", "--sign", "-", str(pending)], check=True)
        pending.replace(target / EXECUTABLE)
    finally:
        pending.unlink(missing_ok=True)


if __name__ == "__main__":
    prepare()
