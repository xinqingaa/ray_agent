"""Bing 结果链接：点击跟踪包装解出真实地址，无法解出时保留原链接。"""
import base64

from app.infrastructure.external.search.bing_search import unwrap_result_url


def wrapped(target: str) -> str:
    encoded = base64.urlsafe_b64encode(target.encode()).decode().rstrip('=')
    return f'https://www.bing.com/ck/a?!&&p=abc&ptn=3&ver=2&hsh=4&psq=kafka&u=a1{encoded}&ntb=1'


def test_unwraps_click_tracking_links():
    assert unwrap_result_url(wrapped('https://kafka.apache.org/documentation/')) == 'https://kafka.apache.org/documentation/'
    assert unwrap_result_url(wrapped('https://例子.cn/路径?q=1')) == 'https://例子.cn/路径?q=1'


def test_keeps_links_that_are_not_wrapped_or_not_decodable():
    for url in ('https://kafka.apache.org/', 'https://www.bing.com/search?q=x', 'https://www.bing.com/ck/a?u=zz',
                'https://www.bing.com/ck/a?u=a1@@@', wrapped('javascript:alert(1)'), 'https://evil.example/ck/a?u=a1aGk'):
        assert unwrap_result_url(url) == url
