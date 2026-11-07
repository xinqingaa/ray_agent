"""工作方式版本、提议与模板的 SQLite 实现。"""
from typing import Optional

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.models.working_style import InstructionProposal, InstructionVersionRecord, WorkingStyleTemplate
from app.domain.repositories.memory_repository import InstructionRepository
from app.infrastructure.models.working_style import (
    InstructionProposalModel,
    InstructionVersionModel,
    WorkingStyleTemplateModel,
)


class DBInstructionRepository(InstructionRepository):
    def __init__(self, db_session: AsyncSession) -> None:
        self.db_session = db_session

    async def add_version(self, record: InstructionVersionRecord) -> None:
        self.db_session.add(InstructionVersionModel.from_domain(record))
        await self.db_session.flush()

    async def get_version(self, workspace_id: str, version: int) -> Optional[InstructionVersionRecord]:
        model = await self.db_session.get(InstructionVersionModel, (workspace_id, version))
        return model.to_domain() if model else None

    async def latest(self, workspace_id: str) -> Optional[InstructionVersionRecord]:
        row = (await self.db_session.execute(
            select(InstructionVersionModel)
            .where(InstructionVersionModel.workspace_id == workspace_id)
            .order_by(InstructionVersionModel.version.desc()).limit(1)
        )).scalar_one_or_none()
        return row.to_domain() if row else None

    async def add_proposal(self, proposal: InstructionProposal) -> None:
        self.db_session.add(InstructionProposalModel.from_domain(proposal))
        await self.db_session.flush()

    async def get_proposal(self, proposal_id: str) -> Optional[InstructionProposal]:
        model = await self.db_session.get(InstructionProposalModel, proposal_id)
        return model.to_domain() if model else None

    async def list_proposals(self, workspace_id: str, *, status: Optional[str] = None) -> list[InstructionProposal]:
        stmt = select(InstructionProposalModel).where(InstructionProposalModel.workspace_id == workspace_id)
        if status:
            stmt = stmt.where(InstructionProposalModel.status == status)
        rows = (await self.db_session.execute(
            stmt.order_by(InstructionProposalModel.created_at.desc()))).scalars().all()
        return [row.to_domain() for row in rows]

    async def save_proposal(self, proposal: InstructionProposal) -> None:
        model = await self.db_session.get(InstructionProposalModel, proposal.id)
        if model is None:
            await self.add_proposal(proposal)
            return
        model.body = proposal.body
        model.rationale = proposal.rationale
        model.status = proposal.status.value
        model.resolved_at = proposal.resolved_at
        await self.db_session.flush()

    async def add_template(self, template: WorkingStyleTemplate) -> None:
        self.db_session.add(WorkingStyleTemplateModel.from_domain(template))
        await self.db_session.flush()

    async def get_template(self, template_id: str) -> Optional[WorkingStyleTemplate]:
        model = await self.db_session.get(WorkingStyleTemplateModel, template_id)
        return model.to_domain() if model else None

    async def list_templates(self) -> list[WorkingStyleTemplate]:
        rows = (await self.db_session.execute(
            select(WorkingStyleTemplateModel).order_by(WorkingStyleTemplateModel.updated_at.desc())
        )).scalars().all()
        return [row.to_domain() for row in rows]

    async def save_template(self, template: WorkingStyleTemplate) -> None:
        model = await self.db_session.get(WorkingStyleTemplateModel, template.id)
        if model is None:
            await self.add_template(template)
            return
        model.name = template.name
        model.body = template.body
        model.tool_suggestions = dict(template.tool_suggestions or {})
        model.updated_at = template.updated_at
        await self.db_session.flush()

    async def remove_template(self, template_id: str) -> None:
        await self.db_session.execute(
            delete(WorkingStyleTemplateModel).where(WorkingStyleTemplateModel.id == template_id))

    async def delete_workspace(self, workspace_id: str) -> None:
        """工作区删除：版本与提议随工作区回收；模板属于应用，不删除。"""
        for model in (InstructionVersionModel, InstructionProposalModel):
            await self.db_session.execute(delete(model).where(model.workspace_id == workspace_id))
