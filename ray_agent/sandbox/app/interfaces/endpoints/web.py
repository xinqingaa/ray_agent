from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.interfaces.schemas.base import Response
from app.services.web import fetch_page

router = APIRouter(prefix='/web', tags=['公开网页读取'])


class FetchRequest(BaseModel):
    url: str = Field(min_length=1, max_length=4096)


@router.post('/fetch', response_model=Response[dict])
async def fetch(request: FetchRequest):
    try:
        return Response.success(await fetch_page(request.url))
    except (ValueError, TimeoutError) as exc:
        return Response.fail(400, str(exc) or '网页读取超过总时限', {'requires_browser':True})
    except Exception:
        return Response.fail(502, '网页网络请求失败；可使用浏览器读取', {'requires_browser':True})
