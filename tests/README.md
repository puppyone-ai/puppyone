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
appearance/typography, auxiliary appearance, sidebar visibility, isolated utility execution,
editor runtime lifecycle, and the complete preset Viewer pane matrix. These fixture scenarios require no real Agent
prompt or paid account. `npm run test:e2e -- --agent-draft` is an additional
installed-runtime-dependent branch of the project-session scenario; the default
e2e command runs project sessions followed by the fixture-based Agent/Terminal
sidebar workflow. Both run without paid requests.

Other `smoke:*` commands are explicit focused checks, not implicitly part of CI.
`smoke:text-selection` is the `text-selection` app gate: production styles and
editors in Electron, every built-in mode, domain overrides, same-ID CSS reload,
retained editor state, nested table inputs, native mouse/keyboard selection,
copy handlers and forced-colors. Active-window assertions use Chromium focus
emulation so concurrent windows cannot steal test focus. It writes computed
results, screenshots and source fingerprints under `artifacts/tests/appearance/`.
`smoke:native-agents` and `smoke:native-agent-references` deliberately require
`RUN_NATIVE_AGENT_SMOKE=1` / `RUN_NATIVE_AGENT_REFERENCE_SMOKE=1`, respectively, and local runtime/account setup; they can execute real
Agent requests. `smoke:codex-agent` likewise uses a locally installed Codex
runtime. Keep these opt-in and preserve their completion/status checks.

## Editor pane interactions

Common gestures belong to `component/workbench/layout/`, not to each format.
`editorSplitResizeInteraction.test.tsx` covers both directions, queued frames,
commit/cancel, capture loss, window lifecycle and lease ownership.
`editorPaneActionsMenu.test.tsx` owns generic menu semantics; CSV menu settings
remain under `editor/formats/csv/`.

`integration/workbench/layout/editorPaneActions.integration.test.tsx` connects
real menu clicks to the real workbench controller, including active/inactive
pane closing, keyboard focus, remaining view/history, final-pane close and late
reads. `integration/editor/runtime/editorPaneContracts.tsx` drives the Electron
matrix; its registry guard and runner live beside it. Fixtures stay under
`fixtures/editor/runtime/` and `fixtures/editor/formats/samples/`.

`npm run smoke:editor-pane-contracts` runs every registered built-in Viewer,
including fallback: 18 file fixtures × two split directions. It exercises real
renderers, live resize, controller split/move, menu close, DOM PDF teardown,
and companion undo/redo through real filesystem IPC. PDF uses its production
capability protocol and a DOM-owned Chromium PDF Viewer iframe. App Preview uses a
controlled runtime port and a real separate-origin iframe. OS child-surface
pointer forwarding is tested separately; this matrix injects Chromium input into
the owner renderer. Its `editor-panes` app gate runs the complete matrix. The
optional `-- --case pdf` selection is diagnostic and is recorded in its report.

## Markdown selection and workspace projection

Pure inline-preview dependency rules belong in
`unit/editor/formats/markdown/links/inlinePreviewLinkIdentity.test.ts`.
Pointer lifecycle behavior belongs in
`component/editor/formats/markdown/rendering/markdownPointerSelection.test.ts`:
release ordering, cancellation, consecutive gestures, pane isolation, committed
edits and destruction run through real EditorView events/transactions with only
coordinate measurement controlled by happy-dom.

The `markdown-selection` app gate (`npm run smoke:markdown-selection-stability`)
uses Chromium mouse input to check forward/backward single-character selection,
CJK, selection across paragraphs, revealed links above the pointer, outside
release, cancellation, link navigation versus dragging, and table/paragraph
geometry across link-index refreshes. Component coverage also drives a real
DataWorkspace folder's first child load and verifies relevant wiki links still
refresh. These checks do not claim OS-level pointer injection or full theme/RTL coverage.
Its Node runner first verifies that an intentional Electron assertion returns
exit code 1, then requires both a successful exit and a positive completion
report from the real scenarios. Closing the fixture window cannot turn a
failed assertion into a passing release check. The mouse-only fixture rejects
physical keyboard input and asserts its source remains unchanged.

## Sidebar visibility and residual content

`integration/workbench/layout/sidebarVisibility.integration.test.tsx` connects
CollapsiblePaneFrame, AuxiliaryPanelHost, Workbench and its real project Store.
Agent and Terminal each exercise retained DOM/inert state, late status/focus,
delayed preparation, repeated transitions, remount and all split panes. Providers
are controlled at the contribution boundary; project resources stay alive.

`e2e/workbench/layout/sidebar-visibility.smoke.mjs` drives the complete Desktop:
ordinary and rapid toggles, late transition completion, mixed split panes, project
switching while closed, Agent/Terminal startup finishing after collapse, keyboard
collapse and collapsed-edge reopening. It checks all content, the underlying
Editor's click/focus/scroll and retention of sessions and Agent drafts. Only
provider discovery/execution uses a synthetic runtime. GPU rendering stays on.
Agent/Terminal share the window DOM; execution remains in utility processes.

The `sidebar-visibility` app gate and `test:e2e` run this workflow by default.
`npm run smoke:sidebar-visibility` runs it alone after building.
`npm run smoke:sidebar-visibility:acceptance` also sends real macOS CoreGraphics
click/wheel events and requires screen capture/event-posting permission. The
ordinary command's Chromium input does not prove OS hit testing.

Shared helpers live in `support/electron/`. DOM captures first prove the visible
paint marker exists, then check its disappearance. OS window captures add checks
for composited residue. After collapse, actual Editor pixels are compared with
the owner renderer (inset region; channel tolerance 30, fewer than 0.5% differing
pixels for caret/raster noise). Both crops and full composites are retained.
Missing screen permission is explicitly recorded as OS pixel checks not run;
strict acceptance fails instead of substituting page capture. PDF is part of the
owner renderer's DOM/compositor tree, so the PDF pane matrix uses ordinary page
capture and verifies that closing the Pane removes both the iframe and Chromium
PDF Viewer frame in both split directions.

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
CoreGraphics input: file/directory/multiple payloads and Editor split/repeat/cancel.
It needs event-posting
permission and temporarily controls the pointer. It uses isolated projects,
restores the pointer and records a unique source-bound report. It does not claim
Windows/Linux native gesture coverage or PDF-format application behavior.

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
