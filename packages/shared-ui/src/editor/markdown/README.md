# Markdown editor source architecture

The public assembly stays at this directory root (`index.ts` plus the editor
and extension entry points). Internal code follows a
hybrid modular-monolith layout:

- `core/` owns the canonical source pipeline, syntax projection, render-plan
  contract, Feature Composition port/facet, editor commands, decorations, and
  generic interaction state. It does not import a concrete built-in feature.
- `composition/` is the one static built-in assembly point. It freezes the
  ordered feature list and builds the detector, compiler, inline-widget, and
  block-widget indexes plus Feature-owned live-preview extensions once. Its
  `preview/` child implements the bounded isolated-string preview port.
- `features/` owns vertical Markdown capabilities such as table, HTML,
  Mermaid, math, image, video, and code block. `features/media/` contains only the
  shared media-reference grammar/resolution contract; image and video retain
  separate models, plans, DOM lifecycles, and focused tests. Each complex
  feature exports one small `*Feature.ts` definition to composition.
- `platform/` owns editor-scoped brokers, sessions, security policy, and
  CodeMirror host adapters. Features request capability through these ports.
- `shared/` contains feature-agnostic widget DOM and measurement primitives.
  `shared/preview/` is the leaf port used to inject isolated preview rendering
  without a Feature importing composition.

Dependency rules:

1. Markdown source is the only committed document truth.
2. A committed editor transaction reports a new revision immediately; it does
   not wait for an idle debounce or for typing to stop.
3. The host Document Session owns snapshot timing, single-flight persistence,
   latest-revision coalescing, acknowledgement, and close/navigation flushes.
   Markdown code never calls filesystem, Electron IPC, or Cloud persistence.
4. Full source does not flow through React on ordinary input. The Session reads
   it from the synchronous snapshot port at an immediate write or explicit
   flush boundary.
5. React cleanup is emergency-only. User-visible close/navigation must await
   the host Session, and persistence errors must remain observable and
   retryable.
6. Pure models and plans never own DOM or persistence.
7. A concrete feature is registered exactly once in the immutable built-in
   Feature Composition. Collectors, compilers, and decorations consume the
   injected composition contract through a CodeMirror facet.
8. Widget construction is render-only; state changes happen through commands,
   effects, and editor-scoped coordinators.
9. Main Feature decorations render atoms/embeds from their compiled plan
   payload. They must not re-tokenize source to rediscover image/video data;
   the table-cell isolated-string adapter is an explicit separate boundary.
10. `shared/` never imports `core/`, `features/`, `composition/`, or `platform/`.
11. `platform/` never imports a concrete feature.
12. Widget render identity is semantic. CodeMirror owns mapped source ranges;
    unrelated offset changes must not remount passive embeds or revoke their
    mounted asset leases.
13. Explicit widget source editing reveals a mapped range of the canonical
    CodeMirror document. A widget must not mount a second editable copy of the
    same Markdown source.

Run `npm run check:markdown-architecture` after changing these boundaries.
