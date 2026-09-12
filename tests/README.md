# Desktop tests

Place tests by **layer → domain → capability → behavior**. Use the same domain
names at every layer; create a folder only when it contains a test. See the
[canonical testing contract](https://github.com/puppyone-ai/puppy-issues/blob/main/document/puppyone-desktop/platform/testing.md)
for ownership and verification policy.

| Directory | What belongs here | Command |
|---|---|---|
| `unit/<domain>/<capability>/` | Pure rules, state transitions and services with controlled dependencies | `npm run test:unit` |
| `component/<domain>/<capability>/` | React/CodeMirror interaction in happy-dom, with controlled ports | `npm run test:component` |
| `integration/<domain>/<capability>/` | Real filesystem, Git, IPC/service combinations; isolated Electron scenarios | `npm run test:integration` (Vitest), `npm run test:desktop` (Electron CI selection) |
| `e2e/<domain>/<capability>/` | User workflows through the complete Desktop application | `npm run test:e2e` (requires build) |
| `architecture/<domain>/<capability>/` | Import, source structure and ownership contracts | `npm run test:architecture` |
| `performance/benchmarks/<domain>/<capability>/` | Repeatable Vitest benchmarks | `npm run bench:performance` |
| `performance/scenarios/<domain>/<capability>/` | Production Chromium timing/layout scenarios | `npm run smoke:renderer-performance`, `npm run smoke:csv-performance` |
| `performance/baselines/` | Reviewed, dated performance reference measurements | See [performance](performance/README.md) |
| `fixtures/<domain>/<capability>/` | Synthetic documents, protocol responses and fixture applications | Imported by scenarios |
| `support/` | Reusable harnesses, localization, Electron helpers and process launchers | Imported, never auto-discovered as cases |
| `config/` | Vitest configuration and focused coverage suites | Root `vitest.config.ts` is the default discovery entry |

`npm test` runs **all** `.test.ts`, `.test.tsx` and `.test.mjs` files across the
four Vitest layers. It never discovers fixtures, smoke entrypoints or benchmarks
as unit tests. `npm run test:typecheck` strictly checks every TS/TSX test,
fixture, support module and benchmark, plus tooling configuration separately.
It is part of both source CI and the production build. Discovery suffixes and
domains have one definition in `config/discovery.mjs`; unsupported names fail
layout checks and actual Vitest discovery is regression-tested.
`npm run test:watch` uses the same selection. A `.tsx` suffix or
happy-dom environment alone does not determine a test's layer.

Markdown lives below `editor/formats/markdown/{parsing,commands,tables,html,embeds,links,rendering}`.
Agent lives below `agent/{sessions,events,composer,transcript,activity,references,controls,history,security,processes,runtimes}`;
provider-specific cases go under `runtimes/{codex,claude,opencode,pi,acp,discovery}`.
Shared setup belongs in `support`, and assertions remain in the case files.

## Electron and CI

Existing `smoke:*` commands remain supported. “Smoke” describes a critical
selection, while Electron describes the runtime; neither is a separate test
layer. The single CI/release selection is
[`scripts/release-checks/checks.json`](../scripts/release-checks/checks.json).
Use `npm run check:release -- --list` to inspect dependencies and
`npm run check:release -- --validate` to validate definitions.

`npm run test:desktop` runs the app selection, including its build dependency:
Markdown focus, resize cursor recovery, Agent rendering/tools, project sessions,
appearance/typography, auxiliary appearance, item utility/renderer isolation,
and editor runtime lifecycle. These fixture scenarios require no real Agent
prompt or paid account. `npm run test:e2e -- --agent-draft` is an additional
installed-runtime-dependent branch; the default e2e command covers project and
Terminal sessions. The isolated item-renderer scenario also verifies Agent draft
retention with a fixture runtime.

Other `smoke:*` commands are explicit focused checks, not implicitly part of CI.
`smoke:native-agents` and `smoke:native-agent-references` deliberately require
`RUN_NATIVE_AGENT_SMOKE=1` / `RUN_NATIVE_AGENT_REFERENCE_SMOKE=1`, respectively, and local runtime/account setup; they can execute real
Agent requests. `smoke:codex-agent` likewise uses a locally installed Codex
runtime. Keep these opt-in and preserve their completion/status checks.

## Coverage and native acceptance

`npm run test:core:coverage` runs the complete suite with a source-inclusive
Editor, Agent and Workbench denominator, including unimported runtime files.
`config/core-coverage-baseline.json` records the measured baseline and each
individual domain's minimum percentages. Preserve the existing Updater and Git
auto-commit coverage gates. Coverage is a regression floor, not proof that every
user workflow is tested. See the canonical contract's behavior matrix for
concurrency, persistence, recovery and native-window acceptance boundaries.

CI runs on PRs and pushes to both `qubits` and `main`. App checks run on Linux
and macOS; platform contracts use the declared target matrix.
`npm run smoke:resource-transfer:acceptance` separately exercises real macOS
CoreGraphics input: file/directory/multiple payloads, Editor split/repeat/cancel,
and an actual PDF native surface over the receiving Pane. It needs event-posting
permission and temporarily controls the pointer. It uses isolated projects,
restores the pointer and records a unique source-bound report. It does not claim
Windows/Linux native gesture coverage or all PDF-format application behavior.

## Evidence and packaging

Disposable reports, coverage, screenshots and timing results go under
`artifacts/tests/`; the release executor retains its run manifests/logs under
`artifacts/release-checks/`. Temporary app profiles and workspace copies remain
separate OS temporary directories. Both report roots are uploaded by CI. Each Vitest invocation (and watch cycle)
owns `artifacts/tests/vitest/<timestamp-scope-random>/`, with JSON results,
coverage, benchmarks and a source-before/after receipt. Release checks snapshot
declared outputs with content hashes and reject missing or stale artifacts.
Source edits during a verification run make that run unsuitable for acceptance.
Production performance defaults also use unique names and record the source
fingerprint plus the actual dist tree identity.
Never overwrite a checked-in performance baseline with routine run output.

`npm run check:test-layout` rejects misplaced test cases and benchmarks and
requires package exclusions for test/spec/bench sources. It is also part of
`check:boundaries`. Built-in renderer smoke routes and their application-side
harnesses remain in `src/` because existing Electron probes exercise those built
routes; this migration preserves that runtime behavior. Test files and standalone
fixture applications are outside the application package inputs.
