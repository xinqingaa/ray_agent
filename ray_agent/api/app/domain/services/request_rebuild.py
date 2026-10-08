#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""请求重建：由运行的 config_snapshot 与会话事件重建某一轮实际发送给模型的消息与工具。

规则：system 消息取自该运行快照里的系统提示词全文；随后按 seq 顺序回放该轮 ``turn(started)`` 之前的全部
``context`` 事件——append 追加消息，strip_reasoning 删除此前的推理字段，replace（自动压缩）把 system 之后的
消息整体替换为事件携带的摘要、用户原文与保留区；工具取快照中适用于该轮的 schema。
只读，不重放任何动作。
"""
import copy
from dataclasses import dataclass, field
from typing import Any, Dict, List, Sequence

from app.domain.models.event import BaseEvent, ContextEvent, ContextOp, TurnEvent, TurnPhase
from app.domain.models.memory import Memory
from app.domain.models.run import Run, tools_for_turn


class TurnNotFoundError(LookupError):
    """运行里没有该序号的轮次。"""


@dataclass
class RebuiltRequest:
    run_id: str
    index: int
    turn_seq: int
    messages: List[Dict[str, Any]]
    tools: List[Dict[str, Any]]
    images: List[Dict[str, Any]] = field(default_factory=list)


def rebuild_request(events: Sequence[BaseEvent], run: Run, index: int) -> RebuiltRequest:
    """events 是会话的全部事件（按 seq 升序，至少包含 context 与 turn 事件）。"""
    turn_seq = next(
        (e.seq for e in events
         if isinstance(e, TurnEvent) and e.phase == TurnPhase.STARTED and e.run_id == run.id and e.index == index),
        None,
    )
    if turn_seq is None:
        raise TurnNotFoundError(f"运行[{run.id}]中不存在第 {index} 轮")

    memory = Memory(messages=[{"role": "system", "content": run.config_snapshot.get("system_prompt", "")}])
    for event in events:
        if event.seq is None or event.seq >= turn_seq:
            break
        if not isinstance(event, ContextEvent):
            continue
        if event.op == ContextOp.APPEND:
            memory.add_messages(copy.deepcopy(event.messages))
        elif event.op == ContextOp.STRIP_REASONING:
            memory.strip_reasoning()
        elif event.op == ContextOp.REPLACE:
            memory.replace(copy.deepcopy(event.messages))
    from app.domain.services.context.vision import image_refs
    return RebuiltRequest(
        run_id=run.id,
        index=index,
        turn_seq=turn_seq,
        messages=memory.messages,
        tools=copy.deepcopy(tools_for_turn(run.config_snapshot, index)),
        images=copy.deepcopy(list(image_refs(memory.messages))),
    )
