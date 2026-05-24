<!-- OPENSPEC:START -->
# OpenSpec Instructions

These instructions are for AI assistants working in this project.

Always open `@/openspec/AGENTS.md` when the request:
- Mentions planning or proposals (words like proposal, spec, change, plan)
- Introduces new capabilities, breaking changes, architecture shifts, or big performance/security work
- Sounds ambiguous and you need the authoritative spec before coding

Use `@/openspec/AGENTS.md` to learn:
- How to create and apply change proposals
- Spec format and conventions
- Project structure and guidelines

Keep this managed block so 'openspec update' can refresh the instructions.

<!-- OPENSPEC:END -->

# ContextBase Backend Guide

The backend's authoritative version architecture is Git-native Version Engine.
Read these first:

- `AGENTS.md`
- `docs/architecture/01-version-engine.md`

Do not reintroduce the removed pre-Git protocol, removed external version
package, or old source/module naming. Web/API/Puppyone CLI writes enter through
`ProductOperationAdapter`; native Git clients enter through `/git/...`; both
publish through `GitNativeTransactionEngine`.

Common commands:

```bash
uv sync
uv run uvicorn src.main:app --host 0.0.0.0 --port 9090 --reload --log-level info --no-access-log
uv run pytest tests/version_engine -q
```
