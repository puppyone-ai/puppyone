# PuppyOne Desktop

Local agent workspace recorder for protected folders.

## Development

```bash
cd desktop
npm install
npm run dev
```

Open the Vite URL shown in the terminal to view the UI in a browser.

For the native shell:

```bash
cd desktop
npm run tauri:dev
```

To build and open the macOS app bundle:

```bash
cd desktop
npm run tauri -- build --debug --bundles app
open "src-tauri/target/debug/bundle/macos/PuppyOne Desktop.app"
```

## UI Direction

`cloud-source/frontend/` is a verbatim mirror of the PuppyOne Cloud frontend
source, including the Data page and its component/lib dependencies. Keep that
mirror untouched and place desktop-specific adapters in `src/`.

Desktop should use the Cloud Data workspace as the canonical interaction model:
app sidebar, project/workspace switcher, data tree, file list, file preview,
changes review, and access/monitor/settings rails. The runtime stays local;
Cloud sync remains an optional layer instead of the default source of truth.

The current desktop shell imports Cloud source components directly for the Data
chrome and file browser where practical:

- `cloud-source/frontend/components/ProjectsHeader`
- `cloud-source/frontend/app/(main)/projects/[projectId]/data/components/views/GridView`
- `cloud-source/frontend/lib/fileIcons`

Vite aliases `@/*` to `cloud-source/frontend/*`, and Tailwind scans both
`src/` and `cloud-source/frontend/` so copied Cloud components keep their
original styles.

## Product Boundary

PuppyOne Desktop is local-first. It records local workspaces, agent sessions,
file changes, snapshots, and undo state in a local store. PuppyOne Cloud remains
the hosted workspace, access, history, and team review surface.
