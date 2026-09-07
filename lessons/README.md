# RayAgent Lessons

Study how RayAgent plans tasks, calls tools, manages execution, and delivers results. Each lesson connects a focused example to the corresponding product implementation.

## Topic map

The topic map defines the scope for lesson writing. Individual lessons will be linked here as they become available.

| Area | Topics |
|---|---|
| Application flow | Startup, a complete conversation, and component responsibilities |
| Models and tools | LLM APIs, structured output, tool calling, and the ReAct loop |
| Planning | Task decomposition, execution, plan updates, and summarization |
| State and events | Persistence, async HTTP, Redis Streams, SSE, and UI updates |
| Sandbox | Browser control, shell commands, files, and storage |
| Protocols | MCP tools, A2A agents, clients, servers, and product integration |
| Failure behavior | Errors, iteration limits, cancellation, disconnects, and cleanup |

## Lesson format

Each lesson covers one coherent topic:

1. Learning objectives and prerequisites.
2. Essential concepts and a runnable example where useful.
3. Product code entry points and the execution path.
4. Design rationale, limitations, and relevant failure behavior.
5. Understanding checks or a focused observation experiment.

Examples and explanations should match the validated implementation. Explain relevant protocol changes where they affect behavior or API usage.

A lesson is complete when the learner can explain the behavior, locate its implementation, and identify its boundaries. Developing a new product feature is not required.

## Related material

- [Labs](../labs/README.md): runnable exercises with separate environments.
- [Application guide](../ray_agent/README.md): configuration, startup, and verification.
- [Execution plan](../PLAN.md): project phases and learning completion criteria.
