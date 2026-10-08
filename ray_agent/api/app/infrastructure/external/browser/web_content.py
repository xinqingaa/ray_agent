"""沙箱网页结果转换；仅提取已抓取 HTML，不发网络请求、不调用模型。"""
from bs4 import BeautifulSoup
from markdownify import markdownify

from app.domain.models.tool_result import ToolResult


def extract_webpage(result: ToolResult) -> ToolResult:
    if not result.success or not isinstance(result.data, dict):
        return result
    data = dict(result.data)
    body = data.pop('body', '')
    login = False
    if data.get('mime') != 'text/plain':
        soup = BeautifulSoup(body, 'html.parser')
        data['title'] = soup.title.get_text(' ', strip=True) if soup.title else ''
        login = soup.select_one('input[type="password"]') is not None
        for node in soup.select('script,style,noscript,template,svg,[hidden],[aria-hidden="true"]'):
            node.decompose()
        root = soup.select_one('main, article, [role="main"]') or soup.body or soup
        content = markdownify(str(root), heading_style='ATX').strip()
        data['method'] = 'html_root_markdown'
    else:
        content = body.strip()
        data['title'] = ''
        data['method'] = 'plain_text'
    requires = login or len(content)<80 or data.get('status',200)>=400
    data.update(content=content[:6000], total_chars=len(content), truncated=len(content)>6000,
                requires_browser=requires)
    if requires:
        data['reason'] = '页面包含登录输入、正文较少或 HTTP 失败；必要时用浏览器确认，不要循环回退。'
    result = ToolResult(success=data.get('status',200)<400, data=data)
    if len(content)>6000:
        result.with_full_content(dict(data, content=content))
    return result
