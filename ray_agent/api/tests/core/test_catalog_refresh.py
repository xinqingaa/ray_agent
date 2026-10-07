"""列表查询不读取模型记忆；事件流在空闲时拉长兜底间隔。"""
from sqlalchemy.dialects import postgresql

from app.application.services.agent_service import next_idle_waits, stream_poll_delay
from app.infrastructure.repositories.db_session_repository import session_list_statement


def test_session_list_query_omits_memory_and_snapshot():
    statement = session_list_statement(independent=True, offset=0, limit=50)
    sql = str(statement.compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}))
    assert "memories" not in sql
    assert "project_snapshot" not in sql
    assert "sessions.files" not in sql


def test_idle_event_stream_backs_off_without_an_active_run():
    assert stream_poll_delay(0) == 3
    assert stream_poll_delay(1) == 3
    assert stream_poll_delay(2) == 30
    assert next_idle_waits(1, active=False, progressed=False) == 2
    assert next_idle_waits(4, active=True, progressed=False) == 0
    assert next_idle_waits(4, active=False, progressed=True) == 0
