# PuppyOne Cloud Source Mirror

This directory is a verbatim source mirror of the PuppyOne Cloud frontend for
desktop reuse work.

Current mirror target:

- `frontend/app/(main)/projects/[projectId]/data`
- `frontend/components`
- `frontend/lib`
- `frontend/contexts`
- `frontend/config`
- `frontend/i18n`
- `frontend/messages`
- `frontend/public`
- Cloud frontend config files such as `package.json`, `tsconfig.json`,
  `tailwind.config.cjs`, and `postcss.config.cjs`

Excluded generated/dependency directories:

- `frontend/node_modules`
- `frontend/.next`
- `frontend/.turbo`
- `frontend/dist`
- `frontend/coverage`

Do not hand-edit mirrored files here. Re-sync from the repo root with:

```bash
desktop/scripts/sync-cloud-source.sh
```

The sync script also copies Cloud runtime assets into the Vite/Tauri app:

- `frontend/public/` → `desktop/public/`
- `frontend/app/globals.css` → `desktop/src/cloud-globals.css`

Desktop-specific adapters should live outside this mirror.
