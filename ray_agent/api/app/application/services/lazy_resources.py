"""独立对话的按需资源端口；资源准备由应用协调层提供，工具不持有数据库。"""
import asyncio


class LazyBrowser:
    def __init__(self, sandbox):
        self.sandbox = sandbox
        self.browser = None
        self._lock = asyncio.Lock()

    async def _get(self):
        async with self._lock:
            if self.browser is None:
                self.browser = await (await self.sandbox.acquire()).get_browser()
            return self.browser

    def __getattr__(self, name):
        if name.startswith('_'):
            raise AttributeError(name)
        async def call(*args, **kwargs):
            return await getattr(await self._get(), name)(*args, **kwargs)
        return call

    async def cleanup(self):
        if self.browser is not None:
            await self.browser.cleanup()
            self.browser = None


class LazySandbox:
    lazy = True

    def __init__(self, factory, existing_id=None):
        self._factory = factory
        self._existing_id = existing_id
        self._resource = None
        self._lock = asyncio.Lock()
        self._browser = LazyBrowser(self)
        self._failure = None

    @property
    def id(self):
        return self._resource.id if self._resource is not None else self._existing_id

    async def acquire(self):
        async with self._lock:
            if self._failure is not None:
                raise RuntimeError('本次运行资源准备已失败，未自动重试') from self._failure
            if self._resource is None:
                try:
                    self._resource = await self._factory()
                except Exception as exc:
                    self._failure = exc
                    raise
            return self._resource

    def __getattr__(self, name):
        if name.startswith('_'):
            raise AttributeError(name)
        async def call(*args, **kwargs):
            return await getattr(await self.acquire(), name)(*args, **kwargs)
        return call

    async def ensure_sandbox(self):
        await self.acquire()

    async def get_browser(self):
        return self._browser

    async def destroy(self):
        if self._resource is None:
            return False
        return await self._resource.destroy()
