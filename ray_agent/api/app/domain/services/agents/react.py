#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
@Time    : 2025/05/21 10:26
@Author  : thezehui@gmail.com
@File    : react.py
"""
import logging
from typing import AsyncGenerator

from pydantic import ValidationError

from app.domain.models.event import (
    StepEventStatus,
    StepEvent,
    ToolEvent,
    MessageEvent,
    ErrorEvent,
    ToolEventStatus,
    WaitEvent,
    BaseEvent
)
from app.domain.models.file import File
from app.domain.models.message import Message
from app.domain.models.plan import Plan, Step, ExecutionStatus
from app.domain.services.prompts.react import REACT_SYSTEM_PROMPT, EXECUTION_PROMPT, SUMMARIZE_PROMPT
from app.domain.services.prompts.system import SYSTEM_PROMPT
from app.domain.services.agents.step_guard import (
    FAKE_TOOL_ERROR,
    FAKE_TOOL_RETRY_PROMPT,
    is_fake_step_completion,
)
from app.domain.services.task_error import STEP_PARSE_ERROR, SUMMARIZE_PARSE_ERROR
from .base import BaseAgent

logger = logging.getLogger(__name__)


class ReActAgent(BaseAgent):
    """基于ReAct架构的执行Agent"""
    name: str = "react"
    _system_prompt: str = SYSTEM_PROMPT + REACT_SYSTEM_PROMPT
    _format: str = "json_object"  # format控制的是content、工具调用控制的是tool_calls两者不冲突

    async def execute_step(self, plan: Plan, step: Step, message: Message) -> AsyncGenerator[BaseEvent, None]:
        """根据传递的消息+规划+子步骤，执行相应的子步骤"""
        # 1.根据传递的内容生成执行消息
        query = EXECUTION_PROMPT.format(
            message=message.message,
            attachments="\n".join(message.attachments),
            language=plan.language,
            step=step.description,
        )

        # 2.更新步骤的执行状态为运行中并返回Step事件
        step.status = ExecutionStatus.RUNNING
        yield StepEvent(step=step, status=StepEventStatus.STARTED)

        # 3.执行步不强制 json_object，避免模型跳过 tool_calls；口头完成后最多再催一次真调用
        query_to_run = query
        for attempt in range(2):
            used_tools: set[str] = set()
            rejected_fake = False
            async for event in self.invoke(query_to_run, format=None):
                # 4.判断事件类型执行不同操作
                if isinstance(event, ToolEvent):
                    used_tools.add(event.function_name)
                    # 5.工具事件需要判断工具的名称是否为message_ask_user
                    if event.function_name == "message_ask_user":
                        # 6.工具如果在调用中，我们需要返回一条消息告知用户需要让用户处理什么
                        if event.status == ToolEventStatus.CALLING:
                            yield MessageEvent(
                                role="assistant",
                                message=event.function_args.get("text", "")
                            )
                        elif event.status == ToolEventStatus.CALLED:
                            # 7.如果工具事件为已调用，则需要返回等待事件并中断程序
                            yield WaitEvent()
                            return
                        continue
                elif isinstance(event, MessageEvent):
                    # 8.返回消息事件，意味着 content 有内容；还须确认不是口头完成
                    parsed_obj = await self._json_parser.invoke(event.message)
                    try:
                        if not isinstance(parsed_obj, dict):
                            raise ValueError(f"步骤结果须为 JSON 对象, 实际为 {type(parsed_obj).__name__}")
                        new_step = Step.model_validate(parsed_obj)
                    except (ValidationError, ValueError) as e:
                        logger.warning(f"步骤结果无法解析为 Step: {e}")
                        step.status = ExecutionStatus.FAILED
                        step.error = str(e)
                        yield StepEvent(step=step, status=StepEventStatus.FAILED)
                        yield ErrorEvent(error=STEP_PARSE_ERROR)
                        return

                    if is_fake_step_completion(step.description, new_step.attachments, used_tools):
                        logger.warning(
                            f"步骤口头完成但未调用工具: {step.description[:50]}... attachments={new_step.attachments}"
                        )
                        rejected_fake = True
                        query_to_run = FAKE_TOOL_RETRY_PROMPT
                        break

                    # 9.更新子步骤的数据
                    step.status = ExecutionStatus.COMPLETED
                    step.success = new_step.success
                    step.result = new_step.result
                    step.attachments = new_step.attachments

                    # 10.返回步骤完成事件
                    yield StepEvent(step=step, status=StepEventStatus.COMPLETED)

                    # 11.如果子步骤拿到了结果，还需要返回一段消息给用户(将结果返回给用户)
                    if step.result:
                        yield MessageEvent(role="assistant", message=step.result)
                    return
                elif isinstance(event, ErrorEvent):
                    # 13.错误事件更新步骤的状态
                    step.status = ExecutionStatus.FAILED
                    step.error = event.error

                    # 14.返回子步骤对应事件后结束本步，避免把失败写成完成
                    yield StepEvent(step=step, status=StepEventStatus.FAILED)
                    yield event
                    return

                # 15.其他场景将事件直接返回
                yield event

            if not rejected_fake:
                break
        else:
            step.status = ExecutionStatus.FAILED
            step.error = FAKE_TOOL_ERROR
            yield StepEvent(step=step, status=StepEventStatus.FAILED)
            yield ErrorEvent(error=FAKE_TOOL_ERROR)
            return

        # 16.循环结束时若步骤已失败则保持失败，否则标为完成
        if step.status != ExecutionStatus.FAILED:
            step.status = ExecutionStatus.COMPLETED

    async def summarize(self) -> AsyncGenerator[BaseEvent, None]:
        """调用Agent汇总历史的消息并生成最终回复+附件"""
        # 1.构建请求query
        query = SUMMARIZE_PROMPT

        # 2.调用invoke方法获取Agent生成的事件
        async for event in self.invoke(query):
            # 3.判断事件类型是否为消息事件，如果是则表示Agent结构化生成汇总内容
            if isinstance(event, MessageEvent):
                # 4.记录日志并解析输出内容
                logger.info(f"执行Agent生成汇总内容: {event.message}")
                parsed_obj = await self._json_parser.invoke(event.message)

                # 5.将解析数据转换为Message对象
                try:
                    if not isinstance(parsed_obj, dict):
                        raise ValueError(f"汇总结果须为 JSON 对象, 实际为 {type(parsed_obj).__name__}")
                    message = Message.model_validate(parsed_obj)
                except (ValidationError, ValueError) as e:
                    logger.warning(f"汇总结果无法解析为 Message: {e}")
                    yield ErrorEvent(error=SUMMARIZE_PARSE_ERROR)
                    continue

                # 6.提取消息中的附件信息
                attachments = [File(filepath=filepath) for filepath in message.attachments]

                # 7.返回消息事件并将消息+附件进行相应
                yield MessageEvent(
                    role="assistant",
                    message=message.message,
                    attachments=attachments,
                )
            else:
                # 8.其他事件则直接返回
                yield event
