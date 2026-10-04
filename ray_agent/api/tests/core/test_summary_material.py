from types import SimpleNamespace as Item
from app.domain.services.summary_material import bound_material, MAX_MATERIAL_CHARS
from app.domain.services.prompts.project import bounded_summaries


def test_material_is_bounded_and_preserves_recent_corrections():
    first = Item(seq=1, payload={'message': '最初目标'})
    updates = [Item(seq=index, payload={'message': '纠正' * 2000}) for index in range(100, 70, -1)]
    finals = [Item(seq=index, run_id=str(index), payload={'message': '结果' * 2000}) for index in range(60, 20, -1)]
    material = bound_material(first, updates, finals, [])
    text_size = len(material['first_user']) + sum(len(x['message']) for x in material['user_updates'] + material['finals'])
    assert text_size <= MAX_MATERIAL_CHARS
    assert len(material['user_updates']) <= 12 and len(material['finals']) <= 12
    assert material['user_updates'][-1]['seq'] == 100
    assert material['source_seq'] == 100


def test_summary_budget_does_not_cut_identity_and_reports_truncation():
    items = [{'session_id': str(x), 'source': 'manual', 'source_seq': x, 'summary': '摘' * 1490} for x in range(10)]
    chosen = bounded_summaries(items)
    assert sum(len(x['injected_text']) for x in chosen) <= 1500
    assert chosen[0]['truncated']
    assert chosen[0]['injected_text'].startswith('对话 0（manual，截止 seq 0）：')
