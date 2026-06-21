# Shared UI Instructions

- This is the editable source of truth for Cloud/Desktop shared product UI.
- Do not import from `frontend/`, `desktop/`, `@/`, `next/*`, `electron`,
  `@tauri-apps/*`, `@supabase/*`, or `swr`.
- Prefer product-semantic component names such as `ExplorerTree`,
  `EditorHost`, and `FilePreview`.
- Keep app shell concerns out of this package. Cloud auth/routing and desktop
  native window behavior belong in their app directories.
- After changes, run `node scripts/sync-desktop-shared-ui.mjs` and then
  `node scripts/check-desktop-shared-ui-sync.mjs`.

