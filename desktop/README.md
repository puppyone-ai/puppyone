# PuppyOne Desktop

Local agent workspace recorder for protected folders.

## Development

```bash
cd desktop
npm install
npm run dev
```

`npm run dev` starts the Vite renderer and opens the Electron native shell.
Use `npm run dev:browser` only when you want to inspect the renderer in a
plain browser; local-folder APIs require Electron preload IPC.

To build the renderer and run the Electron shell against the production build:

```bash
cd desktop
npm run build
npm run start
```

## UI Direction

Desktop shares the stable Data workspace surface through repo-local packages:

- `packages/data-core` owns portable data types and the `DataPort` boundary.
- `packages/data-ui` owns reusable Data workspace UI such as the explorer tree,
  header, file icons, and preview shell.

The desktop app owns its own native shell, title bar, local workspace switcher,
and Electron runtime adapters. Cloud-only app chrome, organization state,
access-point panels, sync panels, and Next.js routing stay in `frontend/`.
The runtime stays local; Cloud sync remains an optional layer instead of the
default source of truth.

Electron owns the local runtime boundary. Renderer code talks to the narrow
`window.puppyoneDesktop` preload bridge for folder selection and local file
listing; it does not receive direct Node.js or filesystem access.

## Product Boundary

PuppyOne Desktop is local-first. It records local workspaces, agent sessions,
file changes, snapshots, and undo state in a local store. PuppyOne Cloud remains
the hosted workspace, access, history, and team review surface.
