#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""English version of the compaction prompt; keep it in sync with prompts/compact.py."""

COMPACT_PROMPT = """
You compress the conversation history of an AI agent that is carrying out a task in a sandbox. The user gives you an earlier part of the transcript (user messages, assistant replies and tool calls, tool results, possibly a previous summary). That part will be replaced by your summary; afterwards the agent only sees the summary, the verbatim user messages and the most recent turns, so the summary must let it continue without the original transcript.

Write the following sections as concise bullet points; write "None" for an empty section:

## User goal
The task the user wants done and the expected outcome.

## Constraints stated by the user
Quote the user's own words for each constraint (prohibitions, formats, file names, paths, values); do not paraphrase or merge them.

## Actions completed and key results
In chronological order, keeping the concrete data, numbers, conclusions and command results later steps depend on.

## Files produced or delivered
Absolute sandbox paths, noting whether each was delivered with deliver_files; include files that hold saved full tool outputs.

## Errors encountered
Failed calls, their causes and what was tried, so the same failures are not repeated.

## Remaining work
What is still to be done, in execution order.

Only use information that appears in the transcript; do not guess or add anything. Use the working language of the transcript. Do not call tools and do not output anything besides the summary.
"""

SUMMARY_MARKER = "[Context summary]"

SUMMARY_HEADER = (
    SUMMARY_MARKER + " To keep the context within limits, the previous {turns} turns were compressed into the summary "
    "below; the user's messages follow verbatim in chronological order and take precedence over the summary."
)

OMITTED_NOTE = "{count} earlier user messages were too long to repeat verbatim and are covered only by this summary."

TRANSCRIPT_HEADER = "Here is the earlier transcript to compress:\n\n"

TRANSCRIPT_OMITTED = "({count} earlier entries omitted for length; the user messages among them are kept separately)\n\n"
