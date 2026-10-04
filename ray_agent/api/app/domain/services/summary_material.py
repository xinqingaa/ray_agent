"""摘要材料有界选择：目标、近期纠正、完成结果和终态分开，避免把意图当事实。"""
MAX_MATERIAL_CHARS = 6000


def bound_material(first, recent, finals, runs):
    remaining = MAX_MATERIAL_CHARS
    def text(event, maximum):
        nonlocal remaining
        value = (event.payload.get('message') or '')[:min(maximum, remaining)] if event else ''
        remaining -= len(value)
        return value
    first_user = text(first, 1600)
    # 优先最新纠正与最近成果，最终按事件顺序提供给模型。
    updates = []
    for event in recent[:12]:
        if first and event.seq == first.seq:
            continue
        value = text(event, 300)
        if value:
            updates.append(dict(seq=event.seq, message=value))
    selected = []
    for event in finals[:12]:
        value = text(event, 600)
        if value:
            selected.append(dict(run_id=event.run_id, seq=event.seq, message=value))
    return dict(first_user=first_user, user_updates=sorted(updates, key=lambda x: x['seq']),
        finals=sorted(selected, key=lambda x: x['seq']),
        run_states=[dict(run_id=r.id, status=r.status, reason=r.reason) for r in runs[:12]],
        source_seq=max([e.seq for e in [*recent, *finals]] + [first.seq if first else 0]),
        truncated=remaining == 0, max_material_chars=MAX_MATERIAL_CHARS)
