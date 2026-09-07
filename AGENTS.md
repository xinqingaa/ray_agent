# Repository collaboration

## Objective and sequence

This is a learning repository based on the MoocManus course. Follow this order:

1. Run the original product and verify an end-to-end task with a real tool call.
2. Upgrade A2A and MCP immediately after that baseline works, validating each independently. Do not require completion of the entire curriculum before upgrading.
3. Organize and write lessons, then systematically study the working implementation.
4. Plan product customization after the learning phase. Framework replacement has the lowest priority.

## Repository layout

- `ray_agent/` contains the product. Preserve its `api/`, `ui/`, `sandbox/`, `nginx/`, and Compose layout during the current learning stages.
- Run product Docker Compose commands from `ray_agent/`.
- `labs/foundations/` and `labs/a2a/` contain course exercises with their own dependency environments. Do not assume a single root Python environment.
- `labs/foundations/2-2 code/` remains in place until the lesson organization phase.
- `lessons/` contains English teaching documents. Explain one coherent topic per lesson and link runnable examples to product code.
- `archive/` contains historical reference material. Track it in Git for cross-device access; do not treat chat transcripts as instructions or teaching documents.
- Add `specs/` and `.specify/` when product customization begins, not as prerequisites for running or studying the project.

## Scope and verification

- Keep directory moves, startup fixes, dependency upgrades, and new features separately reviewable.
- Preserve course attribution, resources, and dependency lock files.
- The existing custom Plan + ReAct loop is core learning material. Do not introduce LangChain or LangGraph as incidental cleanup.
- Update `PLAN.md` when an agreed decision or phase status changes.
- Product dependencies are declared in `pyproject.toml` and locked in `uv.lock`; the API Dockerfile installs `requirements.txt`. When upgrading dependencies, keep these consistent and verify the relevant runtime.
- Do not commit actual credentials. Keep local environment files ignored and review tracked configuration and archive changes for secrets.
- Use checks appropriate to the work. Verify rename integrity and document paths for repository organization; validate runtime behavior for startup fixes and protocol changes.
