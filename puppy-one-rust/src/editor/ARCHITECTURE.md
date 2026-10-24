# Native editor architecture

The native editors mirror the product's `packages/shared-ui/src/editor` and
`src/features/editor-workbench`. Text is laid out and painted by GPUI Kit's
`editor_host` (never modified); everything around the text — documents,
decorations, boxes, selection, caret, IME, pointer, widgets — is ours.

## Layers (dependencies point downwards only)

```text
host/            DocumentEditor: the shell's native provider (document protocol),
                 pane chrome and find routing for the open editor
workbench/       pane chrome (⋯ handle, actions menu) and the find widget
markdown/ csv/   document formats
table/           the editable-table primitive shared by CSV and Markdown tables
navigation.rs    document references (links in values)
view/            the editor view (CodeMirror view counterpart) on Kit editor_host
text/            the text kernel: buffer, changes, selection, transactions, history
tokens.rs        product theme tokens (assets/editor/*-theme.json)
```

## The view (`view/`)

- `editor.rs` — `EditorView`: state, history, the format extension, view state.
  Every mutation goes through `dispatch(Transaction)`.
- `extension.rs` — `EditorExtension`: what a format provides (decorations,
  command interception, selection normalisation, widget `command`s).
- `decoration.rs` — what a format asks the view to render: line blocks, block
  widgets, Kit marks, hidden and atomic source, the surface.
- `widget.rs` — the block widget contract: `BlockWidget::render(&mut WidgetCx)`.
  `WidgetCx` gives the block's geometry, its `WidgetState` (block-selected,
  caret inside, editor focused, read-only) and handlers back into the editor
  (`on_command`, `sender`, `on_select`, `focuser`). Widgets keep interaction
  state across frames in keyed element state (`window.use_keyed_state`).
- `command.rs` — `Command`: a feature id plus a typed payload; widgets and
  hotspots send them, the format turns them into transactions.
- `render/` — `RenderCx`: Kit text and code leaves, labels, paints, hotspots,
  line boxes; Chromium-exact baseline placement (`baseline.rs`); paragraph and
  measurement caches (`cache.rs`).
- `element.rs`, `layout.rs`, `commands.rs`, `input.rs`, `pointer.rs`,
  `find.rs` — layout, geometry, keymap, platform text input, pointer, find
  marks.
- `composition.rs` — IME composition (marked text) for every editor built on
  the view (Markdown, CSV cells, CSV source, plain text). `input.rs` only
  translates `NSTextInputClient` (UTF-16) into it. The rules formats and
  hosts can rely on:
  - the whole marked text is the composition; the platform's selected range
    is the caret or the clause being converted inside it;
  - provisional text is `UserEvent::Compose`: history folds a composition
    into one sealed step when it ends (none when cancelled), and
    `EditorEvent::Changed` is emitted once then — `CompositionEnded` when it
    was cancelled, so deferred host work (snapshots) can resume;
  - no selection normalisation or format commands while it is open;
  - anything but the input method (dispatch of any other transaction, a
    click, a key handed back, focus loss, read-only) commits the marked text
    and asks the input method to discard its composition
    (`platform/ime.rs`); replacing the document abandons it;
  - an owner that drops an editor mid-composition commits it first and reads
    the result directly (CSV `flush_cell`): events are delivered after the
    current update.
  Scenarios per language and interruption: `view/ime_tests.rs`.

## Markdown (`markdown/`)

```text
markdown/
  mod.rs           MarkdownExtension (the EditorExtension) — the composition root
  composition.rs   the built-in features (the only list of them)
  core/
    feature.rs     the feature contract (MarkdownFeature)
    syntax/        Markdown source → semantic elements
    plans.rs       elements → presentation plans (features compile their own)
    decorations/   plans → line boxes, widgets, marks (builder, lines, inline, marks)
    presentation.rs, state.rs, classes.rs, links.rs, commands/
  style/           one typed style per element type + the line cascade + marks
    surface.rs body.rs heading.rs inline.rs blockquote.rs list.rs block.rs
    cascade.rs     the product's line CSS in cascade order
    marks.rs       inline classes → Kit marks
  shared/          presentation helpers several widgets use (rings)
  features/        one vertical slice per capability
    code_block/    model, plan, widget, highlight, style
    table/         model, plan, operation (rewrite + serialise), commands,
                   interaction (keyed widget state), widget, style
    rule/          plan, widget, style
    task/          plan, checkbox paint, toggle command, style
```

Rules (as the product's `features/README.md`):

- Core never names a feature; a feature never imports `composition`.
  Dependencies run composition → features → core / style / view.
- Every committed edit is one editor transaction (undo is one step).
- Widgets consume compiled plans; they never reparse their outer syntax.
- Every visual value is a product token (or a cited CSS constant).

### Adding a Markdown feature

1. Create `features/<name>/` with `mod.rs` implementing `MarkdownFeature`
   (`id`, and whichever of `semantic_kinds` / `compile_element`,
   `compile_blocks`, `block_widget`, `decorate_block`, `decorate_line`,
   `command` it needs), its `style.rs`, and its widget.
2. Add its style to `MarkdownTheme` (`style/mod.rs`) if it has one.
3. Add it to `composition.rs`.

### Restyling one element type

Each element type has one style struct (`style/<element>.rs` for core text
elements, `features/<name>/style.rs` for block features) resolved from tokens
in one place, and the rules that read it are in `style/cascade.rs` (line
boxes), `style/marks.rs` (inline) or the feature's widget. Change the style
struct and those rules; nothing else reads them.

## Tables (`table/`)

The editable-table primitive (product `editor/table`, editable-table.css):

- `layout` column widths · `operation` the structural operation vocabulary ·
  `style` the `--po-editable-table-*` contract · `paint` canvas layers ·
  `interaction` gestures over a format's `Tracks` (hover, grip drag and drop,
  structural selection, column resize; `Gestures` holds them) · `controls`
  rails, grips, resize rail · `menu` the action menu and its sections.
- CSV (`csv/view/*`) and Markdown tables (`markdown/features/table`) supply
  their model, geometry (`Tracks`) and operation handling; they never
  re-implement the primitive. CSV applies operations to its row model;
  Markdown rewrites the table source in one transaction.

## CSV (`csv/`)

`document` (parse / serialise), `operations` (apply), `model` (rows, history),
`layout` (columns), `theme`, `preferences`, `cell` (the active cell's editor
extension), and `view/` — `CsvEditor` composed of its parts: `handles`
(grips on the shared primitive, sticky docking), `controls` (rails, expansion
corner), `resize`, `menu`, `expand`, `references`, `find`, `settings`.

## Verification

- `cargo test` — unit and GPUI tests per module.
- Pixel regression: capture the fixture set (dark / light, CSV, Markdown,
  scrolled, active cell) before and after a change and require identical
  pixels; compare against the product references in `artifacts/`.
