"""长操作的查询、取消与重试：后台任务沿同一 operation_id 读回状态。"""
from fastapi import APIRouter

from app.application.errors.exceptions import NotFoundError
from app.application.services.background_jobs import get_job_runner
from app.interfaces.schemas import Response
from app.interfaces.schemas.operation import OperationView

router = APIRouter(prefix='/operations', tags=['长操作'])


async def _view(job) -> OperationView:
    if job is None:
        raise NotFoundError('操作不存在')
    return OperationView.from_operation(job)


@router.get('/{operation_id}', response_model=Response[OperationView], summary='查询操作状态')
async def get_operation(operation_id: str):
    return Response.success(data=await _view(await get_job_runner().get(operation_id)))


@router.post('/{operation_id}/cancel', response_model=Response[OperationView], summary='请求取消操作',
             description='排队中的操作直接取消；运行中的操作记录取消请求，由执行端在安全点确认。已结束的操作原样返回')
async def cancel_operation(operation_id: str):
    return Response.success(data=await _view(await get_job_runner().cancel(operation_id)))


@router.post('/{operation_id}/retry', response_model=Response[OperationView], summary='重试操作',
             description='失败或取消且类型支持重试时按同一身份重新排队并递增代次；其他状态原样返回')
async def retry_operation(operation_id: str):
    return Response.success(data=await _view(await get_job_runner().retry(operation_id)))
