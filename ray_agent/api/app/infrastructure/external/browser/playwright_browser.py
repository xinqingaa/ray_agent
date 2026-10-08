#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""CDP 浏览器：稳定 tab、版本引用、单次提取与动作后的可选观察。"""
import asyncio
import math
import struct
import io
import time
import uuid
from collections import deque, OrderedDict
from datetime import datetime, timezone
from typing import Optional

from markdownify import markdownify
from playwright.async_api import async_playwright

from app.domain.external.browser import Browser as BrowserProtocol
from app.domain.models.tool_result import ToolResult
from .playwright_browser_fun import OBSERVE_PAGE


def now():
    return datetime.now(timezone.utc).isoformat()


class PlaywrightBrowser(BrowserProtocol):
    # Only CDP target identity is retained; node references live in their document.
    _selected_tabs = OrderedDict()
    def __init__(self, cdp_url: str, llm=None):
        self.cdp_url = cdp_url
        self.playwright = self.browser = self.page = None
        self._tabs = {}
        self._refs = {}
        self._logs = {}
        self._log_seq = {}
        self._next_index = int(uuid.uuid4().hex[:10], 16)
        self._stable_tabs = set()

    def _register(self, page):
        for tab, existing in self._tabs.items():
            if existing == page:
                return tab
        tab = 'tab-' + uuid.uuid4().hex[:8]
        self._tabs[tab] = page
        self._refs[tab] = {}
        self._logs[tab] = deque(maxlen=300)
        self._log_seq[tab] = 0
        page.set_default_timeout(5000)
        page.on('console', lambda msg: self._log(self._register(page), msg.type, msg.text))
        page.on('pageerror', lambda err: self._log(self._register(page), 'pageerror', str(err)))
        page.on('framenavigated', lambda frame: self._refs[self._register(page)].clear() if frame == page.main_frame else None)
        return tab

    def _log(self, tab, level, text):
        self._log_seq[tab] += 1
        self._logs[tab].append(dict(seq=self._log_seq[tab], level=level, text=text[:2000], timestamp=now()))

    async def initialize(self):
        try:
            self.playwright = await async_playwright().start()
            self.browser = await self.playwright.chromium.connect_over_cdp(self.cdp_url, timeout=10000)
            context = self.browser.contexts[0] if self.browser.contexts else await self.browser.new_context()
            context.on('page', self._register)
            for page in context.pages:
                self._register(page)
            await self._refresh_tabs()
            self.page = self._tabs.get(self._selected_tabs.get(self.cdp_url))
            if self.page is None or self.page.is_closed():
                self.page = next((p for p in context.pages if not p.is_closed()), None) or await context.new_page()
            await self._refresh_tabs()
            return True
        except Exception:
            await self.cleanup()
            return False

    async def cleanup(self):
        # 断开 CDP，不关闭别的调用创建的页面。
        if self.browser:
            await self.browser.close()
        if self.playwright:
            await self.playwright.stop()
        self.browser = self.playwright = self.page = None
        self._tabs.clear()
        self._refs.clear()
        self._logs.clear()
        self._log_seq.clear()
        self._stable_tabs.clear()

    async def _refresh_tabs(self):
        """CDP target IDs survive adapter reconstruction; closed tabs are excluded."""
        for context in self.browser.contexts:
            for page in context.pages:
                if page.is_closed():
                    continue
                old = self._register(page)
                if old in self._stable_tabs:
                    continue
                session = await context.new_cdp_session(page)
                try:
                    tab = 'tab-' + (await session.send('Target.getTargetInfo'))['targetInfo']['targetId']
                finally:
                    await session.detach()
                self._stable_tabs.add(tab)
                if old != tab:
                    self._tabs[tab] = self._tabs.pop(old)
                    self._refs[tab] = self._refs.pop(old)
                    self._logs[tab] = self._logs.pop(old)
                    self._log_seq[tab] = self._log_seq.pop(old)

    async def _ensure_page(self, tab_id=None):
        if self.browser is None and not await self.initialize():
            raise ValueError('连接浏览器失败')
        await self._refresh_tabs()
        if tab_id is not None:
            page = self._tabs.get(tab_id)
            if page is None or page.is_closed():
                raise ValueError('标签页不存在或已关闭，请使用 browser_tabs 查看')
            self.page = page
        if self.page is None or self.page.is_closed():
            raise ValueError('当前标签页已关闭，请显式选择其他 tab')
        tab = self._register(self.page)
        self._selected_tabs[self.cdp_url] = tab
        self._selected_tabs.move_to_end(self.cdp_url)
        while len(self._selected_tabs) > 256:
            self._selected_tabs.popitem(last=False)
        return tab

    async def _metadata(self, tab):
        return dict(tab_id=tab, url=self.page.url, title=await self.page.title(), observed_at=now())

    def _failure(self, error, code='browser_error'):
        return ToolResult(success=False, message=str(error), data=dict(action_success=False, error_code=code,
            observation_status='not_requested'))

    async def _target(self, tab, ref=None, index=None):
        if ref is not None and index is not None:
            raise ValueError('ref 与 index 只能提供一个')
        if index is not None and (not isinstance(index, int) or index < 0):
            raise ValueError('index 必须为非负整数')
        handle = await self.page.evaluate_handle(r"""({ref,index}) => {
            const refs = window.__rayAgentRefs;
            const entry = ref ? refs?.get(ref) : [...(refs?.values() || [])].find(e => e.index === index);
            const el = entry?.node;
            if (!el?.isConnected || el.ownerDocument !== document ||
                el.tagName.toLowerCase() !== entry.tag || el.getAttribute('href') !== entry.href ||
                el.getAttribute('type') !== entry.type)
                throw new Error('stale_reference：原节点已失效，请重新观察');
            const labelled = (el.getAttribute('aria-labelledby') || '').split(/\s+/)
                .map(id => document.getElementById(id)?.textContent || '').join(' ').trim();
            const name = (el.getAttribute('aria-label') || labelled || [...(el.labels || [])].map(l => l.innerText).join(' ') ||
                el.innerText || el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('alt') || '').trim().slice(0,240);
            if (name !== entry.name)
                throw new Error('stale_reference：目标语义已变化，请重新观察');
            return el;
        }""", dict(ref=ref, index=index))
        element = handle.as_element()
        if element is None:
            await handle.dispose()
            raise ValueError('stale_reference：目标已失效')
        return element

    async def view_page(self, mode='both', scope='document', ref=None, tab_id=None, max_chars=6000, max_elements=80, wait_for_text=None, timeout_ms=5000):
        started = time.monotonic()
        try:
            tab = await self._ensure_page(tab_id)
            if mode not in ('text', 'interactive', 'both') or scope not in ('document', 'viewport', 'element'):
                raise ValueError('无效的观察模式或范围')
            if scope == 'element':
                await self._target(tab, ref=ref)
            elif ref is not None:
                raise ValueError('ref 仅用于 element 范围')
            if not 200 <= max_chars <= 20000 or not 1 <= max_elements <= 200:
                raise ValueError('max_chars 范围为 200–20000，max_elements 为 1–200')
            if not 1 <= timeout_ms <= 10000:
                raise ValueError('timeout_ms 范围为 1–10000')
            if wait_for_text:
                await self.page.get_by_text(wait_for_text, exact=False).first.wait_for(state='visible', timeout=timeout_ms)
            observation = 'obs-' + uuid.uuid4().hex[:10]
            raw = await asyncio.wait_for(self.page.evaluate(OBSERVE_PAGE, dict(mode=mode, scope=scope,
                target=ref, observation=observation, firstIndex=self._next_index)), timeout=8)
            text = markdownify(raw['html'], heading_style='ATX').strip()
            if mode != 'text':
                self._refs[tab] = {e['ref']: e for e in raw['elements']}
                self._next_index += len(raw['elements'])
                # 清理旧标记，但不破坏 element 观察执行之前的目标。
                await self.page.evaluate('prefix => document.querySelectorAll("[data-ray-ref]").forEach(el => {if (!el.dataset.rayRef.startsWith(prefix)) el.removeAttribute("data-ray-ref")})', observation)
            data = dict(await self._metadata(tab), action_success=True, observation_status='ok',
                observation_id=observation, scope=scope, mode=mode, content=text[:max_chars],
                interactive_elements=raw['elements'][:max_elements], total_chars=len(text),
                total_elements=len(raw['elements']), truncated=len(text)>max_chars or len(raw['elements'])>max_elements,
                incomplete=raw['incomplete'], extraction_limits=raw['extraction_limits'],
                stages_ms={'observation': int((time.monotonic()-started)*1000)})
            if raw['incomplete']:
                data['note'] = '达到提取资源上限，未提取部分不可恢复；请缩小到元素或视口范围。'
            result = ToolResult(data=data)
            if data['truncated']:
                result.with_full_content(dict(data, content=text, interactive_elements=raw['elements']))
            return result
        except Exception as exc:
            return self._failure(exc, 'observation_failed')

    async def _action(self, operation, *, observe='none', tab_id=None):
        if observe not in ('none', 'text', 'interactive', 'both'):
            return self._failure('observe 必须为 none/text/interactive/both', 'invalid_arguments')
        try:
            tab = await self._ensure_page(tab_id)
            await operation(tab)
        except Exception as exc:
            return self._failure(exc)
        # 动作成功之后的观察错误不能诱发动作重放。
        if observe != 'none':
            result = await self.view_page(mode=observe, tab_id=tab)
            if result.success:
                return result
            return ToolResult(message='动作已执行，结果观察失败；请单独观察，不要重放动作。', data=dict(
                action_success=True, observation_status='failed', observation_error=result.message,
                tab_id=tab, url=self.page.url))
        try:
            metadata = await self._metadata(tab)
        except Exception:
            metadata = dict(tab_id=tab, url=self.page.url)
        return ToolResult(data=dict(metadata, action_success=True, observation_status='not_requested'))

    async def navigate(self, url, observe='text', tab_id=None):
        async def op(tab):
            if not url.startswith(('https://', 'http://', 'about:blank')):
                raise ValueError('只支持 HTTP(S) 或 about:blank')
            self._refs[tab].clear()
            await self.page.goto(url, wait_until='domcontentloaded', timeout=15000)
        return await self._action(op, observe=observe, tab_id=tab_id)

    async def restart(self, url):
        await self.cleanup()
        return await self.navigate(url)

    @staticmethod
    def _validate_target(index, ref, x, y):
        has_point = x is not None or y is not None
        if sum((index is not None, ref is not None, has_point)) != 1:
            raise ValueError('必须且只能指定 ref、index 或完整 xy 坐标之一')
        if has_point and (x is None or y is None or not math.isfinite(x) or not math.isfinite(y) or x < 0 or y < 0):
            raise ValueError('必须提供完整的非负有限 xy 坐标')

    async def click(self, index=None, coordinate_x=None, coordinate_y=None, ref=None, tab_id=None, observe='none'):
        try:
            self._validate_target(index, ref, coordinate_x, coordinate_y)
        except ValueError as exc:
            return self._failure(exc, 'invalid_arguments')
        async def op(tab):
            if coordinate_x is not None:
                await self.page.mouse.click(coordinate_x, coordinate_y)
            else:
                await (await self._target(tab, ref, index)).click()
        return await self._action(op, observe=observe, tab_id=tab_id)

    async def input(self, text, press_enter=False, index=None, coordinate_x=None, coordinate_y=None,
                    ref=None, tab_id=None, observe='none'):
        try:
            self._validate_target(index, ref, coordinate_x, coordinate_y)
        except ValueError as exc:
            return self._failure(exc, 'invalid_arguments')
        async def op(tab):
            if coordinate_x is not None:
                await self.page.mouse.click(coordinate_x, coordinate_y)
                handle = await self.page.evaluate_handle('''([x,y]) => {
                    const hit=document.elementFromPoint(x,y), focused=document.activeElement;
                    const target=hit?.closest('input,textarea,[contenteditable="true"]') || hit?.closest('label')?.control;
                    if (!target || target !== focused) throw new Error('坐标未命中已确认的输入目标；未修改内容');
                    return target;
                }''', [coordinate_x,coordinate_y])
                locator = handle.as_element()
            else:
                locator = await self._target(tab, ref, index)
            await locator.fill(text)
            if press_enter:
                await locator.press('Enter')
        return await self._action(op, observe=observe, tab_id=tab_id)

    async def move_mouse(self, coordinate_x, coordinate_y, tab_id=None, observe='none'):
        async def op(tab):
            self._validate_target(None, None, coordinate_x, coordinate_y)
            await self.page.mouse.move(coordinate_x, coordinate_y)
        return await self._action(op, observe=observe, tab_id=tab_id)

    async def press_key(self, key, tab_id=None, observe='none'):
        async def op(tab):
            await self.page.keyboard.press(key)
        return await self._action(op, observe=observe, tab_id=tab_id)

    async def select_option(self, index=None, option=0, ref=None, tab_id=None, observe='none'):
        async def op(tab):
            if option < 0:
                raise ValueError('option 必须为非负整数')
            await (await self._target(tab, ref, index)).select_option(index=option)
        return await self._action(op, observe=observe, tab_id=tab_id)

    async def _scroll(self, direction, edge, tab_id, observe):
        async def op(tab):
            await self.page.evaluate('([d, edge]) => edge ? window.scrollTo(0, d > 0 ? document.documentElement.scrollHeight : 0) : window.scrollBy(0, d * innerHeight * 0.8)', [direction, bool(edge)])
        return await self._action(op, observe=observe, tab_id=tab_id)

    async def scroll_up(self, to_top=None, tab_id=None, observe='none'):
        return await self._scroll(-1, to_top, tab_id, observe)

    async def scroll_down(self, to_down=None, tab_id=None, observe='none'):
        return await self._scroll(1, to_down, tab_id, observe)

    async def console_exec(self, javascript, tab_id=None):
        try:
            tab = await self._ensure_page(tab_id)
            result = await asyncio.wait_for(self.page.evaluate(javascript), timeout=8)
            return ToolResult(data=dict(await self._metadata(tab), result=result, action_success=True))
        except Exception as exc:
            return self._failure(exc)

    async def console_view(self, max_lines=None, level=None, since=0, tab_id=None):
        try:
            tab = await self._ensure_page(tab_id)
            limit = max_lines if max_lines is not None else 50
            if not 1 <= limit <= 300 or since < 0:
                raise ValueError('max_lines 为 1–300，since 为非负序号')
            rows = list(self._logs[tab])
            matching = [r for r in rows if r['seq'] > since and (not level or r['level'] == level)]
            selected = matching[:limit]
            return ToolResult(data=dict(await self._metadata(tab), logs=selected,
                earliest_seq=rows[0]['seq'] if rows else None, latest_seq=self._log_seq[tab],
                next_since=selected[-1]['seq'] if selected else since, has_more=len(matching)>limit,
                dropped=max(0, self._log_seq[tab]-len(rows)), capture_scope='连接后捕获，导航不清空'))
        except Exception as exc:
            return self._failure(exc)

    async def tabs(self, tab_id=None):
        try:
            if self.browser is None and not await self.initialize():
                raise ValueError('连接浏览器失败')
            await self._refresh_tabs()
            if tab_id is not None:
                await self._ensure_page(tab_id)
            rows = [dict(tab_id=t, url=p.url, title=await p.title(), active=p==self.page)
                    for t,p in self._tabs.items() if not p.is_closed()]
            return ToolResult(data={'tabs':rows})
        except Exception as exc:
            return self._failure(exc)

    async def capture_screenshot(self, scope='viewport', ref=None, tab_id=None, for_model=False):
        tab = await self._ensure_page(tab_id)
        if scope not in ('viewport','full_page','element') or (scope != 'element' and ref is not None):
            raise ValueError('无效截图范围或 ref')
        locator = await self._target(tab, ref=ref) if scope == 'element' else None
        if locator:
            box = await locator.bounding_box()
            if not box:
                raise ValueError('截图元素不可见')
            width, height = box['width'], box['height']
        else:
            width,height = await self.page.evaluate('full => full ? [Math.max(innerWidth,document.documentElement.scrollWidth), Math.max(innerHeight,document.documentElement.scrollHeight)] : [innerWidth,innerHeight]', scope=='full_page')
        if max(width,height)>8192 or width*height>16_000_000:
            raise ValueError('截图超过尺寸上限，请缩小到视口或元素')
        started = time.monotonic()
        if locator:
            data = await locator.screenshot(type='png', scale='css', timeout=8000)
        else:
            data = await self.page.screenshot(type='png', full_page=scope=='full_page', scale='css', timeout=8000)
        width,height = struct.unpack('>II', data[16:24])
        if len(data)>8*1024*1024 or width*height>16_000_000 or max(width,height)>8192:
            raise ValueError('截图产物超过大小上限，请缩小范围')
        mime = 'image/png'
        if for_model:
            from PIL import Image
            def normalize():
                with Image.open(io.BytesIO(data)) as picture:
                    picture.thumbnail((2048, 2048), Image.Resampling.LANCZOS)
                    output = io.BytesIO()
                    picture.convert('RGB').save(output, format='JPEG', quality=90)
                    return output.getvalue(), picture.size
            data, (width, height) = await asyncio.to_thread(normalize)
            mime = 'image/jpeg'
            if len(data) > 2 * 1024 * 1024:
                raise ValueError('视觉输入超过 2 MiB，请缩小范围')
        return data, dict(await self._metadata(tab), width=width, height=height, size=len(data), scope=scope, mime_type=mime,
            captured_at=now(), stages_ms={'capture':int((time.monotonic()-started)*1000)})

    async def screenshot(self, full_page: Optional[bool] = None) -> bytes:
        data,_ = await self.capture_screenshot(scope='full_page' if full_page else 'viewport')
        return data
