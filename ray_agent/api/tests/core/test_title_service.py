"""Short title normalization and manual-title race guard."""
import asyncio
from types import SimpleNamespace

from app.application.services.title_service import TitleService, generated_title
from app.domain.models.session import Session


def test_generated_title_stays_short_across_scripts():
    assert generated_title("Title: What a byte is.\nExtra explanation") == "What a byte is"
    assert generated_title("标题：CSV 统计与文件交付。") == "CSV 统计与文件交付"
    assert generated_title("Résumé du rapport trimestriel de la société entière") == "Résumé du rapport trimestriel"


def test_late_auto_title_does_not_replace_manual_title():
    session = Session(title="My title", title_source="manual")
    recorded = []

    class Uow:
        async def __aenter__(self):
            self.session = SimpleNamespace(get_by_id=self.get_by_id, set_title=self.set_title)
            return self

        async def __aexit__(self, *_):
            return False

        async def get_by_id(self, _):
            return session

        lock = get_by_id

        async def set_title(self, _, title, source, expected):
            if session.title_source != expected:
                return False
            session.title, session.title_source = title, source
            return True

    class Ledger:
        async def append(self, _, events, apply):
            async with Uow() as uow:
                await apply(uow)
            recorded.extend(events)

    result = asyncio.run(TitleService(Uow, Ledger()).set_title("id", "Late model title", "auto", "provisional"))
    assert result == ""
    assert session.title == "My title"
    assert recorded == []
