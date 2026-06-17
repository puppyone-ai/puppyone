# Editors

The active file editor contract lives in
[`docs/document/editor-save-construct.md`](../../../docs/document/editor-save-construct.md).

Default file editing is raw-text/session based:

- Markdown uses `MarkdownEditor`.
- Plain text uses `PlainTextEditor`.
- JSON uses the raw Monaco viewer through `monaco-code`.
- CSV/TSV uses `CsvTableViewer` in table/source modes.
- Code/source formats use `MonacoCodeViewer`.
- The right-side document drawer uses `DocumentEditor`.

All new editable file viewers must accept the generic viewer props
`textContent`, `onTextChange`, and `editable`, and must persist through
`useEditorSaveSession` at the page/session layer.

## Archived JSON Editors

The older object/tree JSON editor stack is still in the repository for
reference, but it is not the default editing path:

- `ProjectWorkspaceView`
- `components/editors/table/*`
- `components/editors/code/MonacoJsonEditor.tsx`
- `components/editors/vanilla/*`

Do not re-enable these as a default JSON viewer until they are refactored to use
the same save session, dirty state, navigation guard, and visual surface tokens
defined by the editor construct.
