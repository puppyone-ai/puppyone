# Editor Save Construct

This document defines the save and visual construct for PuppyOne file editors.
Any new file editor must follow this construct unless there is an explicit
product decision to do otherwise.

## Scope

This construct applies to editors that mutate project file content:

- Markdown editor, including live view and source mode
- Raw text editor
- Raw code/Monaco editor when the file format is editable
- CSV/TSV table editor and CSV/TSV source mode
- JSON raw editor
- Right-side `DocumentEditor`

It does not apply to normal forms that mutate configuration records instead of
file bytes, such as workflow forms, access scope settings, OAuth/connect
dialogs, import dialogs, and project settings. Those forms may use their own
Save/Connect/Import buttons, but they should not write file content directly.

## Save Behavior

Editable file content is manual-save by default.

- Editing updates a local draft only.
- The app must show dirty state through the shared save chip.
- `Cmd+S` / `Ctrl+S` saves the active editor if it is dirty.
- Save creates one explicit file write, not a debounce stream of writes.
- Save failure leaves the editor dirty and shows an error/retry state.
- Discard resets the local draft to the last server value.
- Closing the browser tab while dirty must trigger a before-unload warning.
- Switching files or closing an auxiliary editor while dirty must ask before
  discarding the local draft.

Mode switches must not save by themselves. For example, switching Markdown
between live view and source, CSV between table and source, or a document panel
between preview and raw must not persist data unless the user explicitly saves.

## Save Implementation

Use `useEditorSaveSession` for editable file content.

The session owns:

- local draft state
- dirty/clean/saving/saved/error status
- localStorage draft persistence
- save and discard actions
- save error text
- file-key scoping
- JSON syntax validation for strict `.json` files

Components should receive content and emit edits through the generic viewer
contract:

- `textContent`: current draft text
- `onTextChange`: local draft update callback
- `editable`: whether the editor may mutate content

Viewer components must not call `writeFile`, `updateTableData`, or another
persistence API directly. Persistence belongs at the page/session layer.

## Visual Construct

All file editor surfaces must use the global editor tokens from
`app/globals.css`.

- Use `--po-editor-bg` for raw editing surfaces instead of default browser or
  Monaco white.
- Use `--po-editor-padding-*` for document-style editors such as Markdown and
  plain text.
- Use `--po-editor-code-padding-*` for Monaco/source editors.
- Use `--po-editor-compact-padding-*` for constrained side-panel editors.
- Keep editor chrome, table grids, source views, preview views, and empty states
  on PuppyOne color tokens, not literal white backgrounds.
- Register Monaco themes before mount so custom source editors never fall back
  to Monaco's default white `vs` theme.

## Format Registry Rules

For a new editable text-backed format:

1. Add the format to `frontend/lib/fileFormats/registry.ts`.
2. Set `editable: true`.
3. Use a text-backed viewer, usually `monaco-code`, `plain-text`, or a viewer
   adapter that accepts `textContent` and `onTextChange`.
4. Make sure `isTextLikeCategory(format)` returns true for the format.
5. Pick the correct save node type in the page session:
   - Markdown source files save as `markdown`.
   - Strict JSON files save as `json`.
   - Other raw text/code assets save as `file`.

Avoid using `defaultViewer: 'json-table'` for new JSON editing work. The legacy
JSON table editor is archived and intentionally not the default path.

## JSON Rules

JSON is edited as raw text by default.

- `.json` files must parse before save.
- `.jsonc` and `.json5` are stored as raw text and are not validated with
  `JSON.parse`.
- The backend read API must return both `content` and `content_text` for JSON,
  so raw editors can display the exact stored text.
- Do not model source editing as a parsed object only. Invalid in-progress text
  still needs to be represented as a dirty draft.

## CSV/TSV Rules

CSV/TSV table edits serialize to raw CSV/TSV draft text through `onTextChange`.
The user must still save explicitly.

The CSV `Header row` toggle is a view interpretation preference unless the
implementation deliberately rewrites file content through `onTextChange`.
If that behavior changes, update this document and add regression coverage.

## Archived Editors

The old JSON table editor stack is kept in the repository but is not part of the
default editing path:

- `ProjectWorkspaceView`
- `TableDiscreteEditor`
- `MonacoJsonEditor`
- `useJsonTreeActions`

These components have legacy auto-save/object-draft behavior. Do not re-enable
them as a default viewer unless they are first refactored to use the same editor
save session construct.

## Regression Checklist

Before merging an editor/save change:

- Open an editable Markdown file, type, confirm the Save chip appears, save,
  and confirm the chip transitions through saving/saved.
- Open a `.json` file, type valid JSON, save, and confirm it writes as a JSON
  node.
- Type invalid JSON in a `.json` file and confirm save fails without clearing
  the dirty draft.
- Open a CSV file in table mode, edit a cell, confirm it becomes dirty, then
  save.
- Switch editor modes without editing and confirm no dirty state appears.
- Try switching files while dirty and confirm the app asks before discarding.
- Confirm raw JSON/source editors render on PuppyOne editor background, not
  Monaco/browser default white.
- Confirm Markdown, plain text, source, CSV, and right-side document editors
  have consistent padding on desktop and mobile widths.
- Run `frontend` type checking.
- Run backend content read tests if the read/write wire contract changes.
