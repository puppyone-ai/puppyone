# Markdown features

Each complex Markdown capability is a vertical slice. Keep its parser/model
refinement, plan compiler, commands, interaction state, rendering adapter, and
widget lifecycle in the same feature directory.

Each complex capability exports one small `*Feature.ts` definition. That file
wires feature-owned collectors, plan compiler, widget factories, and optional
live-preview extensions to the
leaf contract in `core/features/markdownFeatureContract.ts`; it does not hold
document state or rendering logic. The only list of built-ins lives in
`composition/markdownFeatureComposition.ts`.

Feature internals must not become a second document model: every committed
edit remains one CodeMirror transaction. Widget factories consume compiled
plans and never reparse their outer feature syntax. An isolated nested content
surface (currently table-cell preview) uses the explicit preview port instead
of hiding a tokenizer inside generic decorations.

A Feature never imports `composition/`. Cross-feature compatibility behavior
is supplied through a leaf port (for example the isolated table-cell preview),
so dependency direction remains Composition → Feature → leaf contracts.
