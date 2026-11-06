from .base import BaseTool, tool


class WebTool(BaseTool):
    name = 'web'

    def __init__(self, reader):
        """reader 提供 fetch_webpage(url)，返回整理后的网页正文结果。"""
        super().__init__()
        self.reader = reader

    @tool('web_fetch', '读取已知公开网页正文，适合资料核对。无需渲染时优先用它。登录、JS 页面或用户指定浏览器时用浏览器；不自动携带登录信息。',
          {'url':{'type':'string','description':'公开 HTTP(S) 网页地址'}}, ['url'])
    async def web_fetch(self, url: str):
        return await self.reader.fetch_webpage(url)
