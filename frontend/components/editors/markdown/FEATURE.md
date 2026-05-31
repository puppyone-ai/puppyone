# Markdown Editor Feature Contract

This file records product and engineering agreements for the Markdown editor.
Any change to Markdown editing, preview, save behavior, or mode defaults should
update this contract in the same patch.

## Source Of Truth

- Markdown files are raw text assets. The exact source text is the canonical
  document.
- A normal one-line edit must produce a one-line textual diff unless the user
  explicitly asks for document formatting or semantic rewriting.
- Editor components must not silently normalize Markdown syntax, whitespace,
  list markers, blank lines, heading spacing, table layout, or any other source
  text outside the user's explicit edit.
- The backend write API stores the bytes it receives. It must not be relied on
  to recover raw Markdown once the frontend has already serialized a rewritten
  document.

## Editing Modes

- Markdown has exactly two user-facing modes in the Data page: `Live view` and
  `Source code`.
- Markdown files opened from the Data page default to `Live view`.
- `Source code` is the raw-text editing path and may write exact source text to
  `onChange`.
- `Live view` / WYSIWYG is editable for editable Markdown files. It writes
  Milkdown-serialized Markdown after the user edits in that mode.
- Do not add a separate `Read only` Markdown mode. File-level read-only state is
  controlled by the viewer's `editable` / `readOnly` props, not by a user-facing
  Markdown mode.
- Because Live view can serialize Markdown differently from the original bytes,
  semantic rewriting risk belongs to Live view edits. Switching modes by itself
  must not write or mark the draft dirty.
- Live view must remount on document identity changes so Milkdown never carries
  one file's ProseMirror state into another Markdown file.

## Save Boundary

- `onTextChange` may receive raw source edits from `Source code` or serialized
  Markdown from explicit user edits in `Live view`.
- Manual save commits the current raw text draft. It must not perform hidden
  parse/stringify round trips.
- Local drafts must preserve the exact string they were given, including blank
  lines and trailing whitespace.
- Switching view modes must not mark a Markdown file dirty by itself.
- Opening a Markdown file and saving without editing must be a no-op.

## Milkdown / ProseMirror

- Milkdown parses Markdown into a ProseMirror document and serializes that
  document back to Markdown. That process can rewrite otherwise unchanged
  source text.
- Because of that, Milkdown must be treated as the semantic editing path.
- Keep source-mode editing raw-text preserving even though Live view edits may
  serialize Markdown through Milkdown.

## Regression Checks

- A Markdown fixture with nested lists, blank lines, code fences, and Chinese
  text should survive open -> save with byte-for-byte equality when no edit is
  made.
- Editing one line in source mode should change only that line in the produced
  diff.
- Switching between `Source code` and `Live view` should not rewrite content or
  mark the draft dirty.
- Editing in `Live view` should be covered by tests that accept intentional
  formatting changes while preserving source-mode raw text behavior.
