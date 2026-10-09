#!/usr/bin/env python
# -*- coding: utf-8 -*-
import logging
import urllib.parse

from fastapi import APIRouter, UploadFile, File, Depends, Query, Request
from starlette.responses import StreamingResponse, Response as RawResponse
from app.application.errors.exceptions import AppException, BadRequestError

from app.application.services.file_service import FileService
from app.domain.models.file import File as FileInfo
from app.interfaces.schemas import Response
from app.interfaces.service_dependencies import get_file_service
from pydantic import BaseModel, Field as ModelField

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/files", tags=["文件模块"])


class DownloadBatch(BaseModel):
    file_ids: list[str] = ModelField(min_length=1, max_length=100)


@router.post('/download-batch', summary='将选定附件打包为 ZIP')
async def download_batch(request: DownloadBatch, service: FileService = Depends(get_file_service)):
    stream = await service.download_zip(request.file_ids)
    def chunks():
        try:
            while chunk := stream.read(256*1024):
                yield chunk
        finally:
            stream.close()
    return StreamingResponse(chunks(), media_type='application/zip', headers={
        'Content-Disposition': "attachment; filename*=utf-8''files.zip", 'Cache-Control':'no-store'})


@router.api_route('/download-batch', methods=['GET', 'HEAD'], summary='下载选定附件 ZIP')
async def download_batch_link(request: Request, file_id: list[str] = Query(min_length=1, max_length=100), service: FileService = Depends(get_file_service)):
    if request.method == 'HEAD':
        total = 0
        for identifier in dict.fromkeys(file_id):
            file = await service.get_file_info(identifier)
            if file.visual and file.visual.get('deleted_at'):
                raise AppException(410, 410, '临时图片已过期')
            total += file.size
        if total > 512*1024*1024:
            raise BadRequestError('打包文件总量过大')
        return RawResponse(media_type='application/zip')
    return await download_batch(DownloadBatch(file_ids=file_id), service)


@router.post(
    path="",
    response_model=Response[FileInfo],
    summary="对话文件上传接口",
    description="在对话接口中，将文件上传到文件存储和沙箱中"
)
async def upload_file(
        file: UploadFile = File(...),
        project_id: str | None = Query(None),
        rule_version: str | None = Query(None),
        include_optional: bool = Query(False),
        file_service: FileService = Depends(get_file_service),
) -> Response[FileInfo]:
    """文件上传接口，传递文件返回文件的File信息"""
    fileinfo = await file_service.upload_file(upload_file=file, project_id=project_id, rule_version=rule_version, include_optional=include_optional)
    return Response.success(
        msg="上传文件成功",
        data=fileinfo,
    )


@router.get(
    path="/{file_id}",
    response_model=Response[FileInfo],
    summary="获取文件信息接口",
    description="获取指定会话中对应文件的基础信息",
)
async def get_file_info(
        file_id: str,
        file_service: FileService = Depends(get_file_service),
) -> Response[FileInfo]:
    """获取指定会话中对应文件的基础信息"""
    fileinfo = await file_service.get_file_info(file_id)
    return Response.success(
        msg="获取文件信息成功",
        data=fileinfo,
    )


@router.api_route(
    path="/{file_id}/download",
    methods=['GET', 'HEAD'],
    summary="文件下载接口",
    description="从沙箱or对象存储中下载指定的文件到本地",
)
async def download_file(
        file_id: str,
        request: Request,
        file_service: FileService = Depends(get_file_service),
) -> StreamingResponse:
    """下载指定会话中的指定文件"""
    # 1.调用服务获取文件源数据
    file_data, fileinfo = await file_service.download_file(file_id)

    # 2.对文件中的中文名字进行url编码
    encoded_filename = urllib.parse.quote(fileinfo.filename)

    headers = {
        'Content-Disposition': f"attachment; filename*=utf-8''{encoded_filename}",
        'Content-Length':str(fileinfo.size), 'Cache-Control':'no-store',
    }
    if request.method == 'HEAD':
        file_data.close()
        return RawResponse(media_type=fileinfo.mime_type or 'application/octet-stream', headers=headers)
    def chunks():
        try:
            while chunk := file_data.read(256*1024):
                yield chunk
        finally:
            file_data.close()
    return StreamingResponse(
        content=chunks(), media_type=fileinfo.mime_type or 'application/octet-stream', headers=headers,
    )
