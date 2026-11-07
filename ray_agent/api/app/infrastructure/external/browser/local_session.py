"""本机自动化浏览器会话：每工作区／独立对话独立资料目录，默认无界面。"""
from __future__ import annotations

import logging
import os
from pathlib import Path

from playwright.async_api import async_playwright

from app.domain.external.browser import Browser
from app.domain.external.browser_session import BrowserProfile, BrowserSessionInfo, BrowserSessionState
from app.infrastructure.external.browser.playwright_browser import PlaywrightBrowser
from app.infrastructure.external.components.local_components import BROWSER_ID, LocalRuntimeComponents

logger = logging.getLogger(__name__)


class LocalBrowserSession:
    """实现 BrowserSession：按需启动 Playwright Chromium，资料目录按 profile 隔离。"""

    def __init__(self, components: LocalRuntimeComponents, profiles_root: Path, *,
                 download_dir: Path | None = None) -> None:
        self._components = components
        self._profiles_root = Path(profiles_root)
        self._profiles_root.mkdir(parents=True, exist_ok=True)
        self._download_dir = download_dir
        self._info: BrowserSessionInfo | None = None
        self._browser_tool: PlaywrightBrowser | None = None
        self._playwright = None
        self._context = None
        self._chromium = None

    def _profile_dir(self, profile: BrowserProfile) -> Path:
        if profile.workspace_id:
            path = self._profiles_root / "workspace" / profile.workspace_id
        else:
            path = self._profiles_root / "session" / (profile.session_id or "unknown")
        path.mkdir(parents=True, exist_ok=True)
        return path

    async def start(self, profile: BrowserProfile) -> BrowserSessionInfo:
        status = await self._components.status(BROWSER_ID)
        if status.state.value != "available":
            self._info = BrowserSessionInfo(profile=profile, state=BrowserSessionState.FAILED, headless=True)
            raise RuntimeError(status.detail or "浏览器组件不可用，请先安装")
        browsers = await self._components.locate(BROWSER_ID)
        os.environ["PLAYWRIGHT_BROWSERS_PATH"] = str(browsers)
        self._info = BrowserSessionInfo(profile=profile, state=BrowserSessionState.STARTING, headless=True)
        profile_dir = self._profile_dir(profile)
        download = self._download_dir or (profile_dir / "downloads")
        download.mkdir(parents=True, exist_ok=True)
        self._playwright = await async_playwright().start()
        self._context = await self._playwright.chromium.launch_persistent_context(
            str(profile_dir / "user-data"),
            headless=True,
            accept_downloads=True,
            downloads_path=str(download),
            viewport={"width": 1280, "height": 720},
        )
        # 经 CDP 接到现有 PlaywrightBrowser 实现
        cdp = self._context.browser
        # persistent context 的 browser 可能为 None；直接包装页面
        adapter = _ContextBrowser(self._context)
        if not await adapter.initialize():
            await self.stop()
            raise RuntimeError("浏览器初始化失败")
        self._browser_tool = adapter
        version = None
        try:
            if self._context.browser:
                version = self._context.browser.version
        except Exception:
            pass
        self._info = BrowserSessionInfo(
            profile=profile, state=BrowserSessionState.READY, headless=True, browser_version=version)
        return self._info

    async def info(self) -> BrowserSessionInfo:
        if self._info is None:
            raise RuntimeError("浏览器会话尚未启动")
        return self._info

    async def browser(self) -> Browser:
        if self._browser_tool is None:
            raise RuntimeError("浏览器会话尚未就绪")
        return self._browser_tool

    async def stop(self) -> None:
        try:
            if self._context is not None:
                await self._context.close()
        except Exception:
            logger.debug("关闭浏览器上下文失败", exc_info=True)
        try:
            if self._playwright is not None:
                await self._playwright.stop()
        except Exception:
            logger.debug("停止 playwright 失败", exc_info=True)
        self._context = self._playwright = self._browser_tool = None
        if self._info is not None:
            self._info = self._info.model_copy(update={"state": BrowserSessionState.STOPPED})


class _ContextBrowser(PlaywrightBrowser):
    """用持久化上下文驱动的浏览器适配：跳过 CDP 连接。"""

    def __init__(self, context) -> None:
        super().__init__(cdp_url="local")
        self._context = context

    async def initialize(self):
        try:
            self.playwright = True  # 占位，cleanup 时不 stop 外部 playwright
            self.browser = self._context.browser or self._context
            self._context.on("page", self._register)
            for page in self._context.pages:
                self._register(page)
            await self._refresh_tabs()
            self.page = next((p for p in self._context.pages if not p.is_closed()), None)
            if self.page is None:
                self.page = await self._context.new_page()
            await self._refresh_tabs()
            return True
        except Exception:
            await self.cleanup()
            return False

    async def cleanup(self):
        # 不关闭外部管理的 context／playwright
        self.browser = self.playwright = self.page = None
        self._tabs.clear()
        self._refs.clear()
        self._logs.clear()
        self._log_seq.clear()
        self._stable_tabs.clear()

    async def _refresh_tabs(self):
        # 本机持久化上下文不用 CDP target id，页对象本身即可
        for page in list(self._context.pages):
            if not page.is_closed():
                self._register(page)
