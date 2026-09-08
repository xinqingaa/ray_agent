"""MCP 2026-07-28 客户端实验共用的显式协议固定逻辑。"""
from mcp import types

PROTOCOL_VERSION = "2026-07-28"


async def adopt_protocol(client) -> None:
    """只采用目标协议，不通过旧 initialize 握手降级。"""
    discovery = types.DiscoverResult.model_validate(
        await client.session.send_discover(PROTOCOL_VERSION)
    )
    if PROTOCOL_VERSION not in discovery.supported_versions:
        raise RuntimeError(f"服务端不支持 MCP {PROTOCOL_VERSION}")
    client.session.adopt(discovery)
