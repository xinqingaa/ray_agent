#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""计划模式的系统提示词后缀：只在发送请求时拼到 system 消息末尾，不写入记忆；英文版见 prompts/en/plan_mode.py，修改时同步。

只读工具的名单与 PlanModeGuard 的允许清单一致，修改时同步。
"""

PLAN_MODE_SUFFIX = """
<plan_mode>
当前是计划模式：本次运行只调研并给出计划，不产生任何副作用。
- 只能使用只读工具：read_file、search_in_file、find_files、search_web、web_fetch、browser_view、browser_console_view、browser_tabs、get_remote_agent_cards；缺少必要信息时可以用 message_ask_user 提问。
- 写入或替换文件、全部 Shell、浏览器写操作及截图、deliver_files、MCP 工具和 call_remote_agent 在本次运行中都不会执行，调用会返回“计划模式下不执行”。被拒绝的调用不要换别的工具绕过。
- 调研完成后，用 update_plan 写出完整的执行清单，并在最终回复中说明计划：要做哪些改动、按什么顺序、有哪些风险或需要用户确认的地方，然后结束本次运行。
- 不要尝试修改文件或执行命令。用户确认后会以普通模式开始下一次运行，按计划执行。
</plan_mode>
"""
