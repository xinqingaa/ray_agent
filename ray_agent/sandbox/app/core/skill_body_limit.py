"""在 JSON 解析之前限制 skill 材料请求体，包含分块传输。"""
from starlette.responses import JSONResponse

MAX_BODY_BYTES = 75 * 1024 * 1024


class SkillBodyLimit:
    def __init__(self, app, max_bytes=MAX_BODY_BYTES):
        self.app, self.max_bytes = app, max_bytes

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http' or scope.get('path') != '/api/skills/prepare':
            return await self.app(scope, receive, send)
        chunks, total = [], 0
        while True:
            message = await receive()
            if message['type'] == 'http.disconnect':
                return
            total += len(message.get('body', b''))
            if total > self.max_bytes:
                return await JSONResponse(status_code=413, content={'code': 413, 'msg': 'Skill 材料请求体超限', 'data': {}})(scope, receive, send)
            chunks.append(message.get('body', b''))
            if not message.get('more_body'):
                break
        body = b''.join(chunks)
        delivered = False
        async def bounded_receive():
            nonlocal delivered
            if delivered:
                return await receive()
            delivered = True
            return {'type': 'http.request', 'body': body, 'more_body': False}
        await self.app(scope, bounded_receive, send)
