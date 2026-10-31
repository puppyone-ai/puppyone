# Shared UI Instructions

- This is the editable source of truth for the standalone Desktop app's shared
  product UI. There is no in-repository upstream to sync from or to.
- Do not import from `frontend/`, app-shell source, `@/`, `next/*`, `electron`,
  `@tauri-apps/*`, `@supabase/*`, or `swr`.
- Prefer product-semantic component names such as `ExplorerTree`,
  `DataNodeEditorHost`, `EditorDocumentHost`, and `FilePreview`.
- Keep app shell concerns out of this package. Cloud auth/routing and desktop
  native window behavior belong in their app directories.
- After changes, run `npm run check:shared-ui` from the repository root.
- Cross-product synchronization, when required, is an explicit integration
  change between repositories; do not claim or invoke nonexistent sync scripts.
