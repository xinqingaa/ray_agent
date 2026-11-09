"""本机自动化浏览器会话：每工作区／独立对话独立资料目录，默认无界面。"""
from __future__ import annotations

import asyncio
import logging
from pathlib import Path

from playwright.async_api import async_playwright

from app.domain.external.browser import Browser
from app.domain.external.browser_session import BrowserProfile, BrowserSessionInfo, BrowserSessionState
from app.infrastructure.external.browser.playwright_browser import PlaywrightBrowser
from app.infrastructure.external.components.local_components import BROWSER_ID, LocalRuntimeComponents, load_component_files

logger = logging.getLogger(__name__)
_profiles_in_use: set[Path] = set()


class LocalBrowserSession:
    """实现 BrowserSession：按需启动 Playwright Chromium，资料目录按 profile 隔离。"""

    def __init__(self, components: LocalRuntimeComponents, profiles_root: Path, *,
                 download_dir: Path | None = None, executor_factory=None, owner=None) -> None:
        self._components = components
        self._profiles_root = Path(profiles_root)
        self._profiles_root.mkdir(parents=True, exist_ok=True)
        self._download_dir = download_dir
        self._info: BrowserSessionInfo | None = None
        self._browser_tool: PlaywrightBrowser | None = None
        self._playwright = None
        self._context = None
        self._executor_factory, self._owner = executor_factory, owner
        self._executor = self._driver_process = self._leased_profile = None

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
            raise RuntimeError(status.error.message if status.error else "浏览器组件不可用，请在设置的运行组件中安装")
        browsers = await self._components.locate(BROWSER_ID)
        self._info = BrowserSessionInfo(profile=profile, state=BrowserSessionState.STARTING, headless=True)
        profile_dir = self._profile_dir(profile)
        download = self._download_dir or (profile_dir / "downloads")
        download.mkdir(parents=True, exist_ok=True)
        if profile_dir in _profiles_in_use:
            raise RuntimeError('这个工作区的浏览器正在由另一个运行使用，请稍后重试')
        _profiles_in_use.add(profile_dir)
        self._leased_profile = profile_dir
        try:
            self._playwright = await async_playwright().start()
            if self._executor_factory:
                self._executor = await self._executor_factory()
                # 锁定版本 Playwright 的 Python transport 子进程；登记后 supervisor 同时负责其浏览器子树。
                transport = self._playwright._impl_obj._connection._transport
                registered = await self._executor.register_external(transport._proc.pid, self._owner)
                self._driver_process = registered.process_id
            from app.infrastructure.external.execution.env import build_process_env
            self._context = await self._playwright.chromium.launch_persistent_context(
                str(profile_dir / "user-data"),
                executable_path=str(browsers / load_component_files()[BROWSER_ID]["executable"]),
                headless=True,
                env=build_process_env(),
                accept_downloads=True,
                downloads_path=str(download),
                viewport={"width": 1280, "height": 720},
            )
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
        except BaseException:
            await self.stop()
            raise

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
        if self._executor is not None and self._driver_process is not None:
            status = await self._executor.kill_tree(self._driver_process)
            if status.state.value == "lost":
                raise RuntimeError("无法确认浏览器子树已结束，保留资料目录占用")
        self._executor = self._driver_process = None
        if self._leased_profile is not None:
            _profiles_in_use.discard(self._leased_profile)
            self._leased_profile = None
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


class DeferredBrowserSession:
    """普通对话只装配端口；首次浏览器动作才启动，并在失败和取消时释放资料目录。"""
    def __init__(self, session: LocalBrowserSession, profile: BrowserProfile, on_close=None):
        self.session, self.profile = session, profile
        self._on_close = on_close
        self._lock = asyncio.Lock()
        self._closed = False
        self._adapter = None
        self._viewports = None

    async def browser(self):
        return self

    async def configure_viewports(self, *args):
        self._viewports = args
        if self._adapter:
            await self._adapter.configure_viewports(*args)

    async def restore_viewports(self):
        return await self._adapter.restore_viewports() if self._adapter else []

    async def cleanup(self):
        if self._adapter:
            await self._adapter.cleanup()

    async def stop(self):
        self._closed = True
        await self.session.stop()
        if self._on_close:
            self._on_close()

    def __getattr__(self, name):
        if name.startswith('_') or not hasattr(PlaywrightBrowser, name):
            raise AttributeError(name)
        async def call(*args, **kwargs):
            async with self._lock:
                if self._closed:
                    raise RuntimeError('浏览器会话已结束')
                if self._adapter is None:
                    await self.session.start(self.profile)
                    self._adapter = await self.session.browser()
                    if self._viewports:
                        await self._adapter.configure_viewports(*self._viewports)
            return await getattr(self._adapter, name)(*args, **kwargs)
        return call
