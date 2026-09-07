# RayAgent Lessons

Study how RayAgent plans tasks, calls tools, manages execution, and delivers results. Each lesson connects a focused example to the corresponding product behavior.

## Topic map

This map defines the scope for lesson writing. Individual lessons will be linked here as they become available; phase status and completion criteria belong to the [execution plan](../PLAN.md).

| Area | Topics |
|---|---|
| Application flow | A complete conversation and component responsibilities |
| Models and tools | LLM APIs, structured output, tool calling, and the ReAct loop |
| Planning | Task decomposition, execution, plan updates, and summarization |
| State and events | Persistence, async HTTP, Redis Streams, SSE, and UI updates |
| Sandbox | Browser control, shell commands, files, and storage |
| Protocols | MCP tools, A2A agents, clients, servers, and product integration |
| Failure behavior | Errors, iteration limits, cancellation, disconnects, and cleanup |

## Lesson format

Write each lesson in English and cover one coherent topic:

1. Learning objectives and prerequisites.
2. Essential concepts and a runnable example where useful.
3. Product code entry points and the execution path.
4. Design rationale, limitations, and relevant failure behavior.
5. Understanding checks or a focused observation experiment.

## Teaching and evidence

Start with observable input and output, trace execution and data changes, then explain the abstractions and tradeoffs. Avoid turning lessons into lists of classes or translations of code comments.

Distinguish code facts, inferred design intent, and proposed improvements. Comments and archived discussions provide leads; claims about behavior should be checked against code and, where relevant, execution.

Use verified examples, screenshots, and output. Label instructions that have not been executed and explain the environment needed to reproduce them. Link to the relevant lab or service guide for installation instead of maintaining a second setup procedure.

Make teaching simplifications explicit. A single tool call in an exercise does not establish the behavior of the product loop, and a client example does not demonstrate every protocol capability. Explain relevant interface changes while keeping the lesson focused on the validated implementation.

A lesson is complete when the learner can explain the behavior, locate its implementation, and identify its boundaries. New product features and framework migrations are not required exercises.

## Related material

- [Labs](../labs/README.md): example selection, environments, and execution entry points.
- [Architecture](../docs/architecture.md): current system boundaries, state ownership, and interaction contracts.
- [Application guide](../ray_agent/README.md): deployment configuration and runtime checks.
- [Execution plan](../PLAN.md): phase order and learning completion criteria.

Architecture documentation is the concise implementation reference; lessons develop the explanation through examples and observation. Update a lesson when its example or explanation becomes inaccurate, without duplicating the global architecture or project status.
