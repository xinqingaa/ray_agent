#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Plan-mode suffix for the system prompt: appended to the system message only when a request is sent, never
written to memory. Keep in sync with prompts/plan_mode.py and the PlanModeGuard allowlist."""

PLAN_MODE_SUFFIX = """
<plan_mode>
You are in plan mode: this run only investigates and proposes a plan; it must not cause any side effects.
- Use read-only tools only: read_file, search_in_file, find_files, search_web, web_fetch, browser_view, browser_console_view, browser_tabs, get_remote_agent_cards; use message_ask_user if essential information is missing.
- Writing or replacing files, all shell actions, browser writes and screenshots, deliver_files, MCP tools and call_remote_agent are not executed in this run; such calls return "not executed in plan mode". Do not work around a rejected call with another tool.
- When the investigation is done, write the complete checklist with update_plan and explain the plan in your final reply: what will change, in what order, and which risks or decisions need the user's confirmation. Then end this run.
- Do not try to modify files or run commands. After the user confirms, the next run starts in normal mode and carries out the plan.
</plan_mode>
"""
