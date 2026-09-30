"""W11 设置验证及身份快照，不访问宿主机仓库或产品数据库。"""
import pytest
from pydantic import ValidationError

from app.domain.models.workspace_project import ProjectSettings, ProjectTaskSnapshot, WorkspaceProject
from app.infrastructure.models.project import ProjectModel


def test_settings_preserve_instruction_and_normalize_optional_identity():
    settings = ProjectSettings(name=" 项目 ", instructions="规则一\n  规则二", git_author_name=" 作者 ", git_author_email=" author@example.com ")
    assert settings.name == "项目" and settings.instructions == "规则一\n  规则二"
    assert settings.git_author_name == "作者"
    assert ProjectSettings(name="项目", instructions=" \n ", git_author_name=" ", git_author_email="").instructions is None


@pytest.mark.parametrize("fields", [
    {"name": " "}, {"name": "x" * 161}, {"name": "项目\n新行"},
    {"instructions": "x" * 8001}, {"instructions": "bad\x00value"},
    {"git_author_name": "作者"}, {"git_author_email": "author@example.com"},
    {"git_author_name": "作者", "git_author_email": "not-an-email"},
    {"git_author_name": "作者\n注入", "git_author_email": "author@example.com"},
])
def test_settings_reject_invalid_fields(fields):
    with pytest.raises(ValidationError):
        ProjectSettings(**{"name": "项目", **fields})


def test_snapshot_identity_is_private_environment_and_independent_of_later_settings():
    project = WorkspaceProject(name="项目", path="/tmp/example", instructions="初始说明", git_author_name="Old", git_author_email="old@example.com")
    snapshot = ProjectTaskSnapshot(project_id=project.id, **project.model_dump(include={"path", "name", "instructions", "git_author_name", "git_author_email"}))
    project.instructions = "新说明"
    project.git_author_name = "New"
    assert snapshot.instructions == "初始说明"
    assert snapshot.git_environment() == {"GIT_AUTHOR_NAME":"Old", "GIT_AUTHOR_EMAIL":"old@example.com", "GIT_COMMITTER_NAME":"Old", "GIT_COMMITTER_EMAIL":"old@example.com"}
    assert ProjectTaskSnapshot(project_id=project.id, name="项目", path=project.path).git_environment() == {}
    restored = ProjectTaskSnapshot.model_validate_json(snapshot.model_dump_json())
    assert restored == snapshot
    orm = ProjectModel.from_domain(project)
    assert orm.to_domain() == project
