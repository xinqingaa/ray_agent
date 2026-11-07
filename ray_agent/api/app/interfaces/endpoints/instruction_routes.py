"""工作方式、提议与模板：编辑当前工作方式、处理 Agent 的提议、模板的另存、应用与删除。"""
from typing import Optional

from fastapi import APIRouter, Depends, Query

from app.application.services.working_style_service import WorkingStyleService
from app.interfaces.schemas import Response
from app.interfaces.schemas.instruction import (
    ApplyTemplateRequest, ApplyTemplateResponse, InstructionProposalList, InstructionProposalView, InstructionView,
    RenameTemplateRequest, SaveTemplateRequest, TemplateListResponse, TemplateView, UpdateInstructionRequest,
)
from app.interfaces.service_dependencies import get_working_style_service

router = APIRouter(tags=["工作方式"])


@router.get("/workspaces/{workspace_id}/instruction", response_model=Response[InstructionView],
            summary="当前工作方式", description="尚未设置时正文为空串、版本为空")
async def get_instruction(workspace_id: str, service: WorkingStyleService = Depends(get_working_style_service)):
    workspace, record = await service.current(workspace_id)
    return Response.success(InstructionView.of(workspace, record))


@router.put("/workspaces/{workspace_id}/instruction", response_model=Response[InstructionView],
            summary="发布新的工作方式版本",
            description="用户编辑：发布来源为 user_edit 的新版本。body 超过上限返回 400；version 是工作区 version，不符返回 409 并带最新值")
async def put_instruction(workspace_id: str, request: UpdateInstructionRequest,
                          service: WorkingStyleService = Depends(get_working_style_service)):
    await service.publish(workspace_id, request.body, request.version)
    workspace, record = await service.current(workspace_id)
    return Response.success(InstructionView.of(workspace, record))


@router.get("/workspaces/{workspace_id}/instruction/proposals", response_model=Response[InstructionProposalList],
            summary="Agent 的工作方式提议", description="status 省略时返回全部；待确认的提议未生效")
async def list_proposals(workspace_id: str, status: Optional[str] = Query(default=None),
                         service: WorkingStyleService = Depends(get_working_style_service)):
    items = await service.proposals(workspace_id, status)
    return Response.success(InstructionProposalList(proposals=[InstructionProposalView.of(item) for item in items]))


@router.post("/workspaces/{workspace_id}/instruction/proposals/{proposal_id}/accept",
             response_model=Response[InstructionView], summary="确认提议",
             description="发布来源为 confirmed_proposal 的新版本。提议之后工作方式已变化时提议作废并返回 409，请重新审阅")
async def accept_proposal(workspace_id: str, proposal_id: str,
                          service: WorkingStyleService = Depends(get_working_style_service)):
    await service.accept(workspace_id, proposal_id)
    workspace, record = await service.current(workspace_id)
    return Response.success(InstructionView.of(workspace, record))


@router.post("/workspaces/{workspace_id}/instruction/proposals/{proposal_id}/reject",
             response_model=Response[InstructionProposalView], summary="拒绝提议")
async def reject_proposal(workspace_id: str, proposal_id: str,
                          service: WorkingStyleService = Depends(get_working_style_service)):
    return Response.success(InstructionProposalView.of(await service.reject(workspace_id, proposal_id)))


@router.get("/templates", response_model=Response[TemplateListResponse], summary="工作方式模板列表")
async def list_templates(service: WorkingStyleService = Depends(get_working_style_service)):
    return Response.success(TemplateListResponse(templates=[TemplateView.of(item) for item in await service.templates()]))


@router.post("/templates", response_model=Response[TemplateView], summary="把工作区另存为模板",
             description="只复制当前工作方式正文与可选的工具启用建议；不带记忆、文件、路径或凭据")
async def save_template(request: SaveTemplateRequest, service: WorkingStyleService = Depends(get_working_style_service)):
    return Response.success(TemplateView.of(await service.save_template(
        request.workspace_id, request.name, include_tool_suggestions=request.include_tool_suggestions)))


@router.post("/templates/{template_id}/rename", response_model=Response[TemplateView], summary="重命名模板")
async def rename_template(template_id: str, request: RenameTemplateRequest,
                          service: WorkingStyleService = Depends(get_working_style_service)):
    return Response.success(TemplateView.of(await service.rename_template(template_id, request.name)))


@router.post("/templates/{template_id}/apply", response_model=Response[ApplyTemplateResponse],
             summary="把模板应用到工作区",
             description="发布来源为 template 的新工作方式版本；模板里的工具建议随结果返回，不会自动启用任何开关")
async def apply_template(template_id: str, request: ApplyTemplateRequest,
                         service: WorkingStyleService = Depends(get_working_style_service)):
    _, template = await service.apply_template(request.workspace_id, template_id, request.version)
    workspace, record = await service.current(request.workspace_id)
    return Response.success(ApplyTemplateResponse(
        instruction=InstructionView.of(workspace, record), tool_suggestions=dict(template.tool_suggestions)))


@router.post("/templates/{template_id}/delete", response_model=Response[dict], summary="删除模板",
             description="不影响已经应用过该模板的工作区")
async def delete_template(template_id: str, service: WorkingStyleService = Depends(get_working_style_service)):
    await service.delete_template(template_id)
    return Response.success()
