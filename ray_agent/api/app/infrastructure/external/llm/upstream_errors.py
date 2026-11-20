"""向用户保留上游错误，同时移除上游可能回显的认证信息。"""
import re


def redact_credentials(value: str, key: str) -> str:
    if key:
        # 短测试密钥也可能被上游回显。
        if len(key) < 4:
            value = re.sub(rf"(?<!\w){re.escape(key)}(?!\w)", "[已隐藏]", value)
        else:
            value = value.replace(key, "[已隐藏]")
    return re.sub(r"(Bearer\s+)\S+", r"\1[已隐藏]", value, flags=re.IGNORECASE)


def upstream_message(response, key: str) -> str:
    try:
        body = response.json()
    except ValueError:
        body = None
    candidate = body.get("error", body) if isinstance(body, dict) else body
    if isinstance(candidate, dict):
        candidate = candidate.get("message")
    message = candidate if isinstance(candidate, str) else response.text
    return redact_credentials(message.strip(), key)[:4000] or str(response.reason_phrase)
