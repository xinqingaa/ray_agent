"""项目预览声明仓库协议。"""
from typing import List, Optional, Protocol

from app.domain.models.workspace_preview import PreviewKind, WorkspacePreview


class PreviewRepository(Protocol):

    async def save(self, preview: WorkspacePreview) -> WorkspacePreview: ...

    async def get(self, preview_id: str) -> Optional[WorkspacePreview]: ...

    async def find_matching(
        self,
        *,
        session_id: str,
        kind: PreviewKind,
        root_id: str,
        relative_path: str,
    ) -> Optional[WorkspacePreview]: ...

    async def list_by_session(self, session_id: str) -> List[WorkspacePreview]: ...

    async def list_by_workspace(self, workspace_id: str) -> List[WorkspacePreview]: ...

    async def list_all(self) -> List[WorkspacePreview]: ...

    async def delete(self, preview_id: str) -> bool: ...

    async def delete_by_session(self, session_id: str) -> None: ...

    async def delete_by_workspace(self, workspace_id: str) -> None: ...

    async def delete_all(self) -> None: ...
