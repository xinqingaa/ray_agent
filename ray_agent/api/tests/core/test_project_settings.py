"""W11 设置验证及快照，不访问宿主机目录或产品数据库。"""
import pytest
from pydantic import ValidationError

from app.domain.models.workspace_project import ProjectSettings, ProjectTaskSnapshot, WorkspaceProject
from app.infrastructure.models.project import ProjectModel


def test_settings_preserve_instruction_and_normalize_name():
    settings = ProjectSettings(name=" 项目 ", instructions="规则一\n  规则二")
    assert settings.name == "项目" and settings.instructions == "规则一\n  规则二"
    assert ProjectSettings(name="项目", instructions=" \n ").instructions is None


@pytest.mark.parametrize("fields", [
    {"name": " "}, {"name": "x" * 161}, {"name": "项目\n新行"},
    {"instructions": "x" * 8001}, {"instructions": "bad\x00value"},
])
def test_settings_reject_invalid_fields(fields):
    with pytest.raises(ValidationError):
        ProjectSettings(**{"name": "项目", **fields})


def test_snapshot_is_independent_of_later_settings():
    project = WorkspaceProject(name="项目", instructions="初始说明")
    snapshot = ProjectTaskSnapshot(project_id=project.id, **project.model_dump(include={"name", "instructions"}))
    project.instructions = "新说明"
    assert snapshot.instructions == "初始说明"
    restored = ProjectTaskSnapshot.model_validate_json(snapshot.model_dump_json())
    assert restored == snapshot
    orm = ProjectModel.from_domain(project)
    assert orm.to_domain() == project
