# RayAgent lessons

This directory will contain English teaching documents for understanding the course exercises and the RayAgent product.

## Prerequisites and sequence

First run the original product. Then upgrade and validate A2A/MCP before systematically studying the implementation. Write the lessons against that working baseline, recording relevant differences from the original course without requiring two parallel curricula.

The detailed lesson map will be finalized after those prerequisites. Planned areas include:

- Product startup and the end-to-end conversation path.
- LLM calls, structured output, tool calling, and the custom ReAct loop.
- Planning, execution, state, persistence, and failure handling.
- Async HTTP, event delivery, Redis Streams, and the UI.
- Sandbox, browser, shell, file tools, and file storage.
- MCP and A2A exercises, product integration, and protocol migration notes.

## Lesson structure

Each lesson should cover one coherent topic and include:

1. Learning objectives and prerequisites.
2. Essential concepts and a runnable example where useful.
3. Product code entry points and the execution path.
4. Design rationale, limitations, and relevant failure behavior.
5. Understanding checks or a focused observation experiment.

Adding new product features is not a requirement for completing a lesson. Completion means being able to explain the behavior, locate its implementation, and identify its boundaries.

## Related directories

- [Product](../ray_agent/README.md): the full application.
- [Labs](../labs/README.md): runnable course exercises with separate environments.
- [Plan](../PLAN.md): phase order, acceptance criteria, and current status.
- [Archive](../archive/): historical reference material, not the curriculum.

`specs/` and `.specify/` will be introduced in the later customization phase.
