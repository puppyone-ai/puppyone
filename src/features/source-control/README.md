# Source Control Feature

This folder owns the Desktop source-control experience.

Durable architecture and lifecycle contracts live in
[Git and Source Control Architecture](https://github.com/puppyone-ai/puppy-issues/tree/main/document/puppyone-desktop/source-control).
Keep this file as the code-local ownership map rather than duplicating those
contracts here.

- `types.ts` defines local UI contracts shared across the feature.
- `remotes.ts` parses, masks, and compares Git remote URLs.
- `viewModel.ts` derives source-control state from the raw Git snapshot. Keep button labels, enabled states, display modes, and remote/commit counts here instead of inside TSX views.
- `gitRefreshScheduler.ts` owns cancellable single-flight reads, root epochs,
  generation ordering, retry and focus reconciliation.
- `remoteRefreshPolicy.ts` derives the effective GitHub, PuppyOne Cloud, or
  generic Git fetch target and foreground refresh cadence. It is pure policy;
  timers and IPC stay in the repository lifecycle.
- `repositoryRefreshPolicy.ts` maps structured repository-change causes to
  history invalidation without encoding semantics in log strings.
- `useGitRepositoryLifecycle.ts` owns watcher bootstrap, repository contexts,
  status publication, focus reconciliation, cancellation and history updates.
- `useDesktopGitController.ts` coordinates one window-local repository and must
  keep UI selection and user operations above that lifecycle boundary.
- `components.tsx` contains reusable Git list primitives such as section headers, preview rows, and working-tree rows.
- `VersionControlIcon.tsx` owns the canonical Version Control icon shared by the header, menus, and the opt-in state.
- `VersionControlSetupState.tsx` owns the full-page opt-in state for a local workspace that has not enabled version control.
- `GitChangesSidebar.tsx` is the shell-level entry for the repository Changes
  surface; `SourceControlSidebar.tsx` composes its reusable content. Changes
  preserves the established section-level Commit and Stage-and-Commit flow,
  exposes Pull only when relevant, and places Stash and destructive cleanup
  behind the secondary-action menu. Selecting a change replaces the list with
  its file diff inside the same right sidebar rather than navigating the main
  editor surface.
- `GitHistorySidebar.tsx` owns the repository History surface selected by the
  right-sidebar shell. History, Changes, and Chat are mutually exclusive
  sibling surfaces, not tabs in Chat's auxiliary workbench.
- `GitHistoryTimeline.tsx` owns the virtualized commit timeline shared by the
  History surface. It groups commits into collapsible local-calendar days and
  keeps each row to a commit message, compact change totals, and a restrained
  two-file vertical preview with any overflow count on its own final line.
- `GitCommitDetail.tsx` owns commit metadata and the canonical file-level diff
  composition used inside History.
- `sidebar/GitLocalStatusSection.tsx` owns the shared flat local disclosure
  contract; committed, staged, unstaged, and merge sections compose their
  domain-specific contents through it. Local work must not reuse the provider
  status-card surface.
- `sidebar/GitLocalStatusPanels.tsx` owns those four local panel configurations,
  resource bodies, and action placement so `SourceControlSidebar.tsx` remains
  an orchestration boundary rather than a second presentation module.
- `sidebar/GitSidebarProviders.tsx` owns GitHub and PuppyOne Cloud provider
  presentation. Providers reuse canonical Empty, preview, and operation-button
  primitives and must not execute Fetch themselves.
- `sidebar/GitRemoteSections.tsx` owns generic remote state and the publish
  reminder; `sidebar/GitSidebarPrimitives.tsx` owns operation, disclosure,
  resize, and loading controls.
- `sidebar/useGitSidebarExpansionState.ts` owns keyed disclosure state. All
  current Git panels intentionally start expanded.
- `styles/sidebar-panels.css`, `sidebar-actions.css`,
  `sidebar-providers.css`, and `sidebar-resources.css` own distinct visual
  domains. Do not restore a late source-control override stylesheet to solve
  selector-order conflicts.
- `WorkingFileDetail.tsx` composes local file actions and canonical file surfaces for the focused Changes sidebar detail.
- `diff/GitFileDiffSurface.tsx` is the single fact-first file-level visual contract used by focused Changes and History. Its type label and renderer share one Diff Registry resolution.

The left explorer and main editor remain unchanged while Changes is open or a
Changes diff is focused. Git is not a first-class explorer navigation mode;
the header Changes action is the entry point for working-tree, commit, stash,
pull, and push workflows.

Keep Git command execution in the local API layer. Keep feature state derivation in `viewModel.ts`. Keep components mostly presentational so simple/professional mode, GitHub/Puppyone remote behavior, and future sync actions can evolve without rewriting the whole sidebar.
