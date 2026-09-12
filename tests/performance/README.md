# Renderer performance benchmarks

These benchmarks preserve the performance probes for the two interaction paths
that most directly affect file-opening responsiveness:

- Markdown source parsing, live-preview decoration construction, and React
  editor mount/disposal.
- Explorer selection updates with increasing rendered row counts.
- Markdown link-graph construction for the repository corpus and a bounded
  link-heavy synthetic corpus.
- 10,000-line single-character edits at the top, middle, and end; focus/reveal
  changes; and a table/HTML/Mermaid-heavy edit fixture.
- Oversized-table policy transitions, a 1,000-row windowed plan, the centralized
  hard fallback boundary, and variable-height 5,000-row range lookup.
- Revision-bound continuous A/B file switching and cancellation.
- Desktop Agent 4,000-event projection, 2,000-row virtual transcript, 128 KiB
  Markdown progressive disclosure, expanded command/diff rendering and a
  searchable 500-model picker.

Run them serially so benchmark files do not compete for the same CPU:

```bash
npm run bench:performance
```

To save a machine-specific baseline or compare a later run:

```bash
npm run bench:performance -- --outputJson /tmp/puppyone-performance.json
npm run bench:performance -- --compare /tmp/puppyone-performance.json
```

## Interpretation

- Treat trends and before/after comparisons on the same machine as more
  meaningful than absolute numbers across machines.
- `renderer-interactions.bench.ts` uses happy-dom. It captures synchronous
  React/CodeMirror work and DOM creation, but not Chromium layout, paint, GPU,
  Electron IPC, or OS scheduling.
- The `development StrictMode` case intentionally measures React's development
  mount/effect replay. It is useful for developer experience and should not be
  confused with a production build result.
- These are opt-in benchmarks, not hard CI budgets. A real Electron renderer
  production Electron smoke is the gate for click-to-editor-ready latency and
  main-thread Long Tasks.

When changing the editor, tree, content cache, or link index, record the command,
hardware, branch/commit, median/mean, and p99 for the affected cases.

For Agent Chat, structural bounds are part of the result: transcript DOM must
remain at or below 120 rows; picker DOM at or below 120 options; initial long
Markdown at or below 24 KiB/240 blocks; command output at 64 KiB; inline diff
at 240 lines. The reference M2 Pro results and exact scenarios are recorded in
`baselines/issue-027-agent-chat-m2-pro-2026-07-12.json`.

## Production Electron smoke

Build and run the real Chromium renderer harness:

```bash
npm run build
./node_modules/.bin/electron tests/performance/scenarios/editor/markdown/renderer-performance.smoke.mjs \
  --outputJson /tmp/puppyone-renderer-smoke.json
```

The harness performs 4 warm-ups and 30 measured A/B switches with 1,000
Explorer nodes and 10,000-line Markdown documents. It also applies one real
CodeMirror edit per sample and verifies the production Worker link-index
boundary. After those samples it opens a 1,001-logical-row table, verifies that
the mounted row DOM remains at or below 80 before and after a document-scroll
window change, and retains the structural result in the JSON report. The
command fails when the shell p95 exceeds 16ms, editor-base p95 exceeds 50ms,
input p95 exceeds 16ms, a stale commit occurs, a path-owned Long Task exceeds
50ms, or the oversized-table bound is violated.

Reference Apple M2 Pro / 16 GB / Electron 41.7.2 result on 2026-07-11:

| Measure | p50 | p95 |
|---|---:|---:|
| Preview shell committed | 1.3ms | 1.5ms |
| Content ready | 4.1ms | 5.7ms |
| Base EditorView ready | 3.1ms | 4.4ms |
| Markdown language ready | 10.8ms | 13.5ms |
| Live Preview ready | 26.7ms | 32.5ms |
| 10k input transaction | 0.7ms | 1.2ms |

The same window recorded 0 stale commits and 0 Long Tasks over 50ms. The
machine-readable before/after and smoke summary is in
`baselines/issue-024-m2-pro-2026-07-11.json`.

The atomic Live Preview readiness follow-up additionally verifies computed
visibility: canonical Markdown source is hidden at `editor_base_ready`, and
the editor becomes visible only after the matching document surface completes its
handoff. The probe selects that document explicitly while the previous surface
may still be mounted. Repeated readiness observations after a completed open
retain the first timing; cancelled, wrong-document and unseen late stages still
fail the stale-commit check. Its warm
30-sample and cold-first-open evidence is recorded in
`baselines/markdown-preview-readiness-m2-pro-2026-07-13.json`.

## Cold first open and background-index contention

The warm run does not cover lazy module evaluation or the period when the
workspace backlink index first starts. Run the independent cold gate too:

```bash
npm run smoke:renderer-cold-performance
```

It starts a fresh visible Electron process, performs no warm-up, enables
content indexing, records the first 10,000-line Markdown click, and observes
the renderer for another 1.5 seconds. On the reference M2 Pro, five independent
acceptance runs reached painted Live Preview in 80.5–94.6ms; base editor
readiness was 32.7–44.2ms. All recorded zero Long Tasks over 50ms.

The root-cause stress comparison is intentionally stronger than the ordinary
warm smoke. The eager implementation produced four renderer Long Tasks (62ms,
202ms, 329ms, and 486ms) while reading/indexing up to 250 files. Streaming one
document per idle turn with Worker acknowledgement backpressure produced zero
Long Tasks in the same observation window.

A final 30-sample visible run with indexing enabled reported shell p95 1.5ms,
base editor p95 4.3ms, painted preview p95 27.6ms, and input p95 1.3ms, with no stale
commits or Long Tasks. The machine-readable evidence is in
`baselines/issue-024-motion-freeze-hardening-m2-pro-2026-07-11.json`.

Tracing adds profiler overhead and is diagnostic evidence only; use the
non-traced cold command for the acceptance budget.

## Output locations

Vitest writes benchmark results into the invocation's unique
`artifacts/tests/vitest/<timestamp-scope-random>/benchmarks.json`.
Electron timing probes use unique timestamp/UUID names under
`artifacts/tests/performance/` and include source and built-artifact identity; explicit
`--outputJson` paths still work. Reviewed reference files live in `baselines/`.
`renderer-smoke-legacy.json` preserves the formerly tracked
`artifacts/performance/renderer-smoke-latest.json` unchanged as historical
evidence; it is not automatically refreshed or used as a current threshold.
