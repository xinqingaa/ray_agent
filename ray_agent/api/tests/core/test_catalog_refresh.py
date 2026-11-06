"""事件流在空闲时拉长兜底间隔。"""
from app.application.services.agent_service import next_idle_waits, stream_poll_delay


def test_idle_event_stream_backs_off_without_an_active_run():
    assert stream_poll_delay(0) == 3
    assert stream_poll_delay(1) == 3
    assert stream_poll_delay(2) == 30
    assert next_idle_waits(1, active=False, progressed=False) == 2
    assert next_idle_waits(4, active=True, progressed=False) == 0
    assert next_idle_waits(4, active=False, progressed=True) == 0
