# 第三方许可摘要

本内部包随附的 Python 核心、共享界面与受管组件包含开源依赖。完整许可文本随各包的 `LICENSE`／`dist-info` 文件分发；下列为产品侧摘要，不替代原许可全文。

## 受管组件（见 `component_manifest.json`）

| 组件 | 许可 |
|---|---|
| browser-chromium（Playwright Chromium） | BSD-3-Clause |
| embedding-e5（multilingual-e5-small ONNX） | MIT |
| ocr（RapidOCR／PaddleOCR 模型） | Apache-2.0 |

## 核心运行时（摘要）

Python 解释器与标准库按 PSF 许可；PyInstaller 引导程序按其许可证。主要直接依赖还包括（不穷尽）：FastAPI／Starlette、SQLAlchemy、Alembic、aiosqlite、Pydantic、httpx、ONNX Runtime、LanceDB、PyArrow、OpenCV、NumPy、tokenizers、Playwright、RapidOCR。各自以包内许可证为准。

## 界面

共享界面基于 React、Vite、Radix UI、Tailwind CSS 与 IBM Plex 字体等，许可见对应 npm 包。

正式对外分发（P10）前应生成完整许可证清单并随安装包交付。
