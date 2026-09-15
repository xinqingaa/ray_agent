"""用本地响应观察点击、页面重绘和结果检查；不调用模型或公网。"""
import argparse
import asyncio
from importlib.metadata import version

from playwright.async_api import async_playwright, expect


HTML = """<!doctype html><html lang="zh"><meta charset="utf-8">
<title>规格与价格实验</title>
<h1>旅行杯</h1>
<div id="choices"><button type="button">大杯</button></div>
<p id="status">小杯</p><p id="price" data-ready="true">¥39</p>
<script>
document.querySelector('button').onclick = async () => {
  document.querySelector('#status').textContent = '正在查询大杯';
  document.querySelector('#price').dataset.ready = 'false';
  // 替换节点，保留同样的名称，便于比较 Locator 和旧节点引用。
  document.querySelector('#choices').innerHTML = '<button type="button">大杯</button>';
  try {
    const response = await fetch('/price');
    if (!response.ok) throw new Error('价格服务失败');
    const result = await response.json();
    document.querySelector('#price').textContent = result.price;
    document.querySelector('#price').dataset.ready = 'true';
    document.querySelector('#status').textContent = result.spec;
  } catch (error) {
    document.querySelector('#status').textContent = '价格查询失败';
  }
};
</script></html>"""


async def run(channel: str | None, fail_price: bool) -> None:
    release_price = asyncio.Event()
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(channel=channel)
        try:
            context = await browser.new_context()

            async def respond(route):
                if route.request.url == 'https://browser-lab.test/price':
                    # 控制响应时刻，避免靠机器快慢制造“点击后尚未就绪”。
                    await release_price.wait()
                    await route.fulfill(
                        status=503 if fail_price else 200,
                        content_type='application/json',
                        body='{"spec":"大杯","price":"¥59"}',
                    )
                elif route.request.url == 'https://browser-lab.test/':
                    await route.fulfill(content_type='text/html', body=HTML)
                else:
                    await route.abort()

            await context.route('**/*', respond)
            page = await context.new_page()
            await page.goto('https://browser-lab.test/')
            print(f'Playwright {version("playwright")} / 浏览器 {browser.version}')
            button = page.get_by_role('button', name='大杯', exact=True)
            old_element = await button.element_handle()
            await button.click()
            await expect(page.locator('#status')).to_have_text('正在查询大杯')
            await expect(page.locator('#price')).to_have_attribute('data-ready', 'false')
            print('点击已返回；价格尚未就绪；旧价格:', await page.locator('#price').inner_text())
            assert old_element is not None
            assert not await old_element.evaluate('(element) => element.isConnected')
            await expect(button).to_be_visible()
            print('旧节点已脱离 DOM；同一个 Locator 可以找到替换后的按钮')

            release_price.set()
            if fail_price:
                await expect(page.locator('#status')).to_have_text('价格查询失败')
                await expect(page.locator('#price')).to_have_attribute('data-ready', 'false')
                print('价格查询失败；¥39 仍是旧值，不能作为大杯价格交付')
            else:
                await expect(page.locator('#price')).to_have_attribute('data-ready', 'true')
                await expect(page.locator('#status')).to_have_text('大杯')
                await expect(page.locator('#price')).to_have_text('¥59')
                print('结果检查通过：大杯 /', await page.locator('#price').inner_text())
            await old_element.dispose()
            await context.close()
        finally:
            release_price.set()
            await browser.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--channel', help='例如 chrome；默认使用 Playwright 配套 Chromium')
    parser.add_argument('--fail-price', action='store_true', help='模拟价格响应失败')
    args = parser.parse_args()
    asyncio.run(run(args.channel, args.fail_price))
