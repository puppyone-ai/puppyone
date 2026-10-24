# Third-party material

Original project code follows the repository [Apache-2.0 license](../LICENSE).
Dependencies and assets retain their own licenses.

## GPUI native input

[GPUI 0.2.2](https://crates.io/crates/gpui/0.2.2), by the Zed contributors,
is licensed under Apache-2.0. `src/native_editor/gpui/input.rs` (exported through `src/ui/input.rs`) is adapted from the published
crate's `examples/input.rs`: native selection, text shaping, clipboard and
`EntityInputHandler` integration. This project adds multiline wrapping,
style runs, editing limits, grouped IME history, model events and caret scrolling.
The shell, integrated native editor and independent probe use this shared module.
The upstream crate records source revision
`zed-industries/zed@69e2130295c2649963eb639fc70b4f2ee8ea1624` (dirty packaging tree);
that revision identifies the original example, not the current dependency graph.
The current text renderer and ordinary form engine are provided by Kit.

No Zed application/editor implementation is included. The integrated native editor
and probe own their document models, formatting, table commands and history.

## GPUI Kit

[GPUI Kit 0.8.0](https://github.com/longbridge/gpui-kit/tree/v0.8.0), Apache-2.0,
is the single application UI dependency. It supplies Base, Component, assets,
and the matching gpui-pre 0.3.9 platform crates. The app uses public widgets and
`base::text::editor_host`; no Kit source is vendored or forked, and no independent
Markdown editor package is included. Ordinary Input/Textarea editing and history
are upstream; the continuous document retains its host-owned editing model.

## Other material

- `unicode-segmentation`: MIT OR Apache-2.0; grapheme boundaries.
- Embedded icons/fonts and their retained notices: [assets/README.md](assets/README.md).
- Probe fonts and dependency details: [native-editor-probe/THIRD_PARTY.md](native-editor-probe/THIRD_PARTY.md).

Both Cargo lockfiles pin the full dependency graph. This is an unpublished local
experiment; a distributable package still needs a complete dependency-notice audit.
