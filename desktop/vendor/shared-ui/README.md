# PuppyOne Shared UI

This directory is the source of truth for UI shared by PuppyOne Cloud and
PuppyOne Desktop.

The desktop copy under `desktop/vendor/shared-ui` is generated. Do not edit the
desktop copy directly; run:

```bash
node scripts/sync-desktop-shared-ui.mjs
node scripts/check-desktop-shared-ui-sync.mjs
```

## Boundaries

Shared UI may depend on React, browser-safe DOM APIs, and local files in this
directory. It must not depend on Next.js routing, Supabase, SWR, Electron,
Tauri, Node filesystem APIs, or app-specific source trees.

Platform-specific shell code stays in `frontend/` and `desktop/`.

