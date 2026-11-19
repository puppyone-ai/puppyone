# PuppyOne Shared UI

This directory is the editable source of truth for shared product UI used by
the standalone PuppyOne Desktop repository. It is not a generated directory,
and this repository has no in-tree Cloud source or sync script.

After changes, run `npm run check:shared-ui` from the repository root. Any
future Cloud/Desktop synchronization must be introduced as an explicit package
or repository integration with real provenance and verification tooling.

## Boundaries

Shared UI may depend on React, browser-safe DOM APIs, and local files in this
directory. It must not depend on Next.js routing, Supabase, SWR, Electron,
Tauri, Node filesystem APIs, or app-specific source trees.

Platform-specific shell code stays in the application source outside this
directory.
