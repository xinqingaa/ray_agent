"""浏览器工具契约：动作、观察和截图留证可分别选择。"""
from app.domain.external.browser import Browser
from app.domain.models.tool_result import ToolResult
from .base import BaseTool, tool

TAB = {'tab_id': {'type':'string', 'description':'browser_tabs 返回的标签页 id；省略使用当前页，不自动切到弹窗'}}
OBSERVE = {'observe': {'type':'string', 'enum':['none','text','interactive','both'], 'description':'动作后返回一次观察；默认 none，navigate 默认 text'}}
REF = {'ref': {'type':'string', 'description':'最近观察的元素 ref，优先使用'},
       'index': {'type':'integer', 'description':'最近观察的元素 index，不能与 ref 同传'}}
POINT = {'coordinate_x': {'type':'number'}, 'coordinate_y': {'type':'number'}}
TARGET = {**REF, **POINT, **TAB, **OBSERVE}


class BrowserTool(BaseTool):
    name = 'browser'

    def __init__(self, browser: Browser, capture=None):
        super().__init__()
        self.browser = browser
        self.capture = capture

    @tool('browser_view', '定向读取页面正文或交互元素。长结果保存到完整输出；按目标范围取必要信息。', {
        **TAB, 'mode':{'type':'string','enum':['text','interactive','both']},
        'scope':{'type':'string','enum':['document','viewport','element']},
        'ref':{'type':'string','description':'element 范围需要有效元素 ref'},
        'wait_for_text':{'type':'string','description':'可选：等到目标文本可见再观察'},
        'timeout_ms':{'type':'integer','description':'目标等待 1–10000 ms，默认 5000'},
        'max_chars':{'type':'integer','description':'正文预览 200–20000，默认 6000'},
        'max_elements':{'type':'integer','description':'元素预览 1–200，默认 80'}}, [])
    async def browser_view(self, **options):
        return await self.browser.view_page(**options)

    @tool('browser_navigate', '打开网址并在同一次调用返回观察，默认正文。交互任务可选 both。',
          {'url':{'type':'string'}, **TAB, **OBSERVE}, ['url'])
    async def browser_navigate(self, url, **options):
        return await self.browser.navigate(url, **options)

    @tool('browser_restart', '断开并重连浏览器，打开网址；仅连接故障时使用。', {'url':{'type':'string'}}, ['url'])
    async def browser_restart(self, url):
        return await self.browser.restart(url)

    @tool('browser_click', '点击元素。必须且只能指定 ref、index 或完整 xy 坐标之一；可请求动作后观察。', TARGET, [])
    async def browser_click(self, **options):
        return await self.browser.click(**options)

    @tool('browser_input', '覆盖输入文本。必须指定 ref、index 或完整 xy 坐标之一。失败不自动重复输入。',
          {'text':{'type':'string'}, 'press_enter':{'type':'boolean'}, **TARGET}, ['text'])
    async def browser_input(self, text, **options):
        return await self.browser.input(text, **options)

    @tool('browser_move_mouse', '移动鼠标至指定位置。', {**POINT, **TAB, **OBSERVE}, ['coordinate_x','coordinate_y'])
    async def browser_move_mouse(self, coordinate_x, coordinate_y, **options):
        return await self.browser.move_mouse(coordinate_x, coordinate_y, **options)

    @tool('browser_press_key', '按键或组合键，可请求一次结果观察。', {'key':{'type':'string'}, **TAB, **OBSERVE}, ['key'])
    async def browser_press_key(self, key, **options):
        return await self.browser.press_key(key, **options)

    @tool('browser_select_option', '选择下拉选项，option 从 0 开始；必须提供 ref 或 index。',
          {'option':{'type':'integer'}, **REF, **TAB, **OBSERVE}, ['option'])
    async def browser_select_option(self, option, **options):
        return await self.browser.select_option(option=option, **options)

    @tool('browser_scroll_up', '向上滚动一屏或到顶部。', {'to_top':{'type':'boolean'}, **TAB, **OBSERVE}, [])
    async def browser_scroll_up(self, to_top=None, **options):
        return await self.browser.scroll_up(to_top, **options)

    @tool('browser_scroll_down', '向下滚动一屏或到底部。', {'to_bottom':{'type':'boolean'}, **TAB, **OBSERVE}, [])
    async def browser_scroll_down(self, to_bottom=None, **options):
        return await self.browser.scroll_down(to_bottom, **options)

    @tool('browser_console_exec', '在页面执行 JavaScript；可能有副作用。优先用定向观察和标准动作。',
          {'javascript':{'type':'string'}, **TAB}, ['javascript'])
    async def browser_console_exec(self, javascript, **options):
        return await self.browser.console_exec(javascript, **options)

    @tool('browser_console_view', '读取连接后捕获的 console/pageerror；按级别、序号和数量缩小范围。',
          {'max_lines':{'type':'integer'},'level':{'type':'string'},'since':{'type':'integer'}, **TAB}, [])
    async def browser_console_view(self, max_lines=None, **options):
        return await self.browser.console_view(max_lines, **options)

    @tool('browser_tabs', '列出标签页；提供 tab_id 则显式选择该页。弹窗不会自动切换。', TAB, [])
    async def browser_tabs(self, tab_id=None):
        return await self.browser.tabs(tab_id)

    @tool('browser_screenshot', '按明确目的保存并交付截图附件，无需再 deliver_files；仅留证，不向模型输入图像，不能据此声称完成视觉判断。',
          {'purpose':{'type':'string'}, 'scope':{'type':'string','enum':['viewport','full_page','element']},
           'ref':{'type':'string','description':'元素截图需要 ref'}, **TAB}, ['purpose'])
    async def browser_screenshot(self, purpose, scope='viewport', ref=None, tab_id=None):
        if not purpose.strip() or len(purpose)>300:
            return ToolResult(success=False, message='请提供不超过 300 字符的具体截图目的')
        if self.capture is None:
            return ToolResult(success=False, message='当前运行未提供截图存储')
        return await self.capture(purpose=purpose, scope=scope, ref=ref, tab_id=tab_id)
