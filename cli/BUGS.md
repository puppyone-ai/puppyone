# CLI Bug Backlog

Recorded during the filesystem/access CLI review. These are intentionally
not fixed in the filesystem concurrency patch.

## Gateway output helpers

- `gateway providers` and `gateway ls` pass array rows/columns to
  `out.table()`, but `out.table()` expects object rows and `{ key, label }`
  column descriptors.
- Several `gateway` commands call `out.success()` with arrays or strings.
  `out.success()` currently only emits valid JSON for object payloads.

## Auth option handling

- `auth whoami --api-url --api-key` reads only saved config, so command-line
  auth overrides are ignored.
- `auth whoami` human output labels the account as `User:` rather than
  exposing an `email` field, while `cli/tests/run.sh` expects "email".

## Datasource gateway autodetect

- `access add <datasource>` passes `{ params: { provider } }` to
  `client.get()`, which serializes as `params=[object Object]` instead of
  `provider=...`.
- `access providers` currently prints only MUT-native/platform providers
  (`direct`, `agent`, `mcp`, etc.). The integration test expects datasource
  providers such as Gmail/Notion/GitHub, so provider discovery needs a
  deliberate split or unified output contract.

## Agent create config

- `access add agent --model/--system-prompt` writes `config.model` and
  `config.system_prompt`; the backend create path expects `llm_model` and
  does not currently consume the CLI `model` value.
