# Desktop Feature Architecture

This document records durable product and frontend architecture decisions for
PuppyOne Desktop. It is intentionally written as implementation guidance, not as
release notes.

## Cloud Workspace State Boundaries

### Requirement

The desktop Cloud surface must not show a signed-out or global warning state
when the user is already signed in and the issue is actually a workspace,
project, or partial data-loading condition.

This requirement exists because the Cloud desktop page combines several
concepts that look similar in the UI but have different product meanings:

- user authentication
- the Cloud API host tied to the current session
- the Cloud API host implied by the current workspace Git remote
- the local workspace to Cloud project mapping
- project-level data availability
- partial failures for optional project sections

These states must stay separate. A user who is signed in must not be asked to
sign in again unless the active workspace truly requires a different Cloud API
host or the saved session is expired.

### Problem

The desktop Cloud page can regress if one component treats every missing value
as the same state. Common bad outcomes are:

1. A saved session exists, but it was restored for the default Cloud API host
   while the current workspace remote points to another host. The page then
   renders signed-out UI even though the user is already authenticated
   elsewhere.
2. One project subrequest fails, such as MCP endpoints or connector state, and
   the whole page shows a red global banner even though the project list,
   contents, and access state may still be usable.
3. A workspace has a PuppyOne Git remote but the API has not resolved the
   project mapping yet. The UI incorrectly treats this as an auth problem.
4. A local folder is not mapped to a Cloud project. The UI incorrectly treats
   this as a data-loading error.

These are architecture problems. They cannot be solved reliably with ad hoc
banner filtering inside page components.

### Final Architecture

The Cloud desktop frontend must be modeled as four independent state layers:

```ts
type CloudEnvironment = {
  apiBaseUrl: string | null;
  source: "remote" | "config" | "default";
};

type CloudAuthState =
  | { status: "restoring"; apiBaseUrl: string | null }
  | { status: "signed-out"; apiBaseUrl: string | null }
  | { status: "signed-in"; apiBaseUrl: string | null; session: DesktopCloudSession }
  | { status: "wrong-host"; apiBaseUrl: string; session: DesktopCloudSession }
  | { status: "expired"; apiBaseUrl: string | null };

type CloudWorkspaceBindingState =
  | { status: "unmapped" }
  | { status: "resolving"; remoteUrl: string }
  | { status: "mapped"; projectId: string }
  | { status: "remote-only"; remoteUrl: string }
  | { status: "error"; message: string };

type CloudProjectDataState<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; data: T; warning?: string }
  | { status: "error"; message: string };
```

The exact TypeScript names may evolve, but the separation must remain:

- `CloudEnvironment` answers: which Cloud API host does this workspace imply?
- `CloudAuthState` answers: does the user have a valid session for that host?
- `CloudWorkspaceBindingState` answers: is this local folder connected to a
  Cloud project?
- `CloudProjectDataState` answers: did a specific project section load?

No page or sidebar component should infer one layer from another by checking a
generic `error`, `loading`, or `session` boolean.

### State Ownership

The preferred file boundaries are:

```text
desktop/src/features/cloud/
  environment/
    resolveCloudEnvironment.ts

  auth/
    useCloudSessionForEnvironment.ts
    cloudAuthTypes.ts

  workspace/
    useCloudWorkspaceBinding.ts
    cloudWorkspaceTypes.ts

  data/
    useCloudProjects.ts
    useCloudProjectOverview.ts
    useCloudAccessData.ts
    useCloudBranchesData.ts

  routes/
    cloudRoutes.ts
    CloudRouter.tsx

  pages/
    CloudProjectsPage.tsx
    CloudContentsPage.tsx
    CloudAccessPage.tsx
    CloudGitSyncPage.tsx
    CloudBillingPage.tsx
    CloudTeamPage.tsx

  states/
    CloudSignedOutState.tsx
    CloudWrongHostState.tsx
    CloudUnmappedState.tsx
    CloudRemoteOnlyState.tsx
```

The current code may still have transitional compatibility files, but new work
should move toward these boundaries instead of adding more conditions to
`CloudServiceMainView`, `CloudRouter`, or a catch-all `states.tsx`.

### Error Severity

Cloud errors must be classified before they reach the UI:

- Auth blocking: no valid session for the current environment. Render sign-in
  or wrong-host UI.
- Workspace blocking: local folder is not mapped, or a remote cannot be
  resolved. Render connect, backup, or remote-only UI.
- Project blocking: the selected project cannot be loaded at all. Render the
  page-level error for that project.
- Section warning: a noncritical project subsection failed. Render a local
  warning inside that page or section, not a global red banner.

Global red banners are reserved for blocking conditions that prevent the active
Cloud page from doing its primary job. Optional project subrequests must not
escalate to global banners.

### Implementation Rules

1. Restore session for the active environment.

   Initial app startup may restore any saved session, but the Cloud workspace
   page must also restore a session for the API base derived from the current
   workspace remote. During that check, render a restoring state instead of
   flashing signed-out UI.

2. Do not equate `session === null` with signed out until environment restore
   has completed.

   A missing session before environment resolution is an unknown state, not a
   product decision.

3. Model wrong-host explicitly.

   If a valid session exists for one Cloud API host and the workspace remote
   points to another host, show a wrong-host state with a clear login or switch
   action. Do not silently discard the session or show generic sign-in copy.

4. Keep workspace mapping separate from authentication.

   A user can be signed in while the local folder is unmapped, remote-only, or
   still resolving. Those states should offer connect, backup, Git Sync, or
   refresh actions, not auth actions.

5. Load data by route, not as one eager bundle.

   Project list, overview, contents, access, branches, organization team, and
   billing should have separate data hooks. Eager project-wide loading is
   acceptable only as a transitional implementation.

6. Do not reuse one `error` field for every Cloud failure.

   Use separate blocking errors and section warnings. If a section can render
   degraded content, its failure is a warning, not a page-level error.

7. Route metadata is the navigation source of truth.

   Sidebar labels, route ids, web paths, route context, and route visibility
   should come from route descriptors. Do not duplicate section lists in the
   sidebar and router.

8. Sign-in copy must name the actual host problem.

   "Sign in to load this Cloud workspace" is only valid for an auth-blocking
   state. For host mismatch, say that the workspace belongs to another Cloud
   host. For unmapped folders, say that the folder needs to be connected.

### Current Code Boundaries

- `desktop/src/features/cloud/environment/resolveCloudEnvironment.ts`
  - derives the active Cloud API host from the workspace remote or workspace
    config.
  - is the only place page components should ask "which Cloud host does this
    workspace imply?"

- `desktop/src/features/cloud/auth/`
  - owns environment-specific session restoration and auth-state resolution.
  - exposes helpers such as `getCloudAuthSession` and `isCloudAuthBlocking`
    so page components do not collapse wrong-host, expired, restoring, and
    signed-out states into a generic missing-session check.

- `desktop/src/features/cloud/workspace/`
  - owns workspace-to-project mapping resolution and binding state derivation.
  - route components should branch on `CloudWorkspaceBindingState` instead of
    manually combining `remote`, `projectId`, `loading`, and `error`.

- `desktop/src/features/cloud/data/`
  - owns Cloud project list loading, mapped-project resolution orchestration,
    and project detail loading.
  - `useDesktopCloudData` is still the transitional aggregate hook, but its
    internal request context key must stay private and project section partial
    failures must remain warnings instead of global blocking errors.

- `desktop/src/features/cloud/routes/cloudRoutes.ts`
  - owns route ids, labels, web paths, and sidebar visibility.
  - project-scoped route paths must require an explicit project id; do not
    silently generate empty `/projects//...` URLs.

- `desktop/src/features/cloud/routes/CloudRouter.tsx`
  - routes the active Cloud section to a page or workspace state.
  - should not grow into a second data-loading or auth state machine.

- `desktop/src/features/cloud/CloudServiceMainView.tsx`
  - is the current transitional container for session restoration, selected
    project state, and Cloud actions.
  - future changes should move environment auth and workspace binding out of
    this component.

- `desktop/src/lib/cloudSession.ts`
  - owns secure-session restore and in-memory session cache behavior.
  - must support restoring for the active workspace API base.

- `desktop/src/features/cloud/data/`
  - owns Cloud data hooks.
  - should continue moving from one eager hook toward route-scoped hooks.

### Verification

For Cloud state changes, the minimum automated verification is:

```bash
cd desktop
npx tsc --noEmit
npm run build
```

Manual verification should cover:

- app launch with a saved session and no Cloud remote
- app launch with a saved session and a PuppyOne Cloud remote
- switching between workspaces with different Cloud remotes
- an expired saved session
- a workspace remote whose API host differs from the saved session host
- an unmapped local folder
- a remote-only workspace while project mapping is still resolving
- partial failures for access, MCP endpoints, connectors, history, and tree
  loading

### Invariants

These invariants should remain true after future changes:

- A signed-in user is not shown signed-out UI until environment-specific restore
  has completed.
- Host mismatch is a first-class state, not a generic auth failure.
- Workspace mapping state is independent from auth state.
- Project data warnings do not become global red banners.
- Sidebar navigation derives from route descriptors.
- Route-specific pages own route-specific data loading.
- `CloudServiceMainView` and `CloudRouter` do not become catch-all state
  machines again.

## Cloud Branch Graph Layout

### Requirement

The desktop Cloud `Branches` page must render a compact Git history graph that
uses Git's own topology ordering. The page must not implement a second,
component-local branch layout engine from `parent_ids`, because that quickly
drifts from real Git behavior for merge commits, remote heads, and branch
compaction.

### Final Architecture

The graph layout has three layers:

1. `desktop/local-api/workspace.mjs` is the topology source. `readGitHistory`
   calls stock `git log --graph --topo-order` and returns `graph_prefix` plus
   `graph_continuation_prefixes` alongside commit metadata.
2. `desktop/src/features/cloud/model.ts` converts those Git graph prefixes into
   `CloudBranchGraphLine` / `CloudBranchGraphSegment` view-model objects. This
   layer may assign product colors, labels, and branch-ref markers, but it must
   not infer commit topology from React state. It also owns ref-only rows for
   branch heads that do not map to a visible commit.
3. `desktop/src/features/cloud/sections/BranchesSection.tsx` renders the graph
   lines and commit rows. It owns SVG drawing only; it must not decide lane
   order, merge routing, or branch lifetime.

`parent_ids` remain useful for metadata, diff workflows, and resolving branch
head labels, but not for hand-rolling graph lane layout in the UI.

Branch refs are product state, not just commit topology. If Git collapses a
branch head onto an existing ancestry line, the model should still expose a
small branch-ref marker so the user can see that the branch exists at that
commit.

### Display Examples

The examples below use text diagrams to describe the intended visual output.
`H` is the current workspace `HEAD`, `●` is a commit, `│`, `/`, and `\` are
Git topology lanes, and `[ref]` means a branch/tag-like ref marker plus a row
label. `[ref x3]` means several refs of the same visual class point at the same
commit and should be grouped into one marker with a count.

#### 1. Linear Current Branch

```text
H  Update desktop cloud and editor surfaces  [newmu]
│
●  desktop v0.0.1
│
●  Update config.json
```

Render this as one topology lane. The current `HEAD` commit may use the `H`
marker. Do not invent another branch lane just because the current branch has a
name; the row label already names it.

#### 2. Remote Ref On The Same Head After Push

```text
H  Update desktop cloud and editor surfaces  [newmu] [origin/newmu]
│
●  desktop v0.0.1
```

This is the "after push" state: local and remote refs point to the same commit.
Use one commit node and one topology lane. Render remote/local refs as row
labels; if a non-current remote ref needs a graph marker, attach a compact ref
marker to the same node. Do not draw parallel lanes.

#### 3. Local Branch Ahead Of Remote Before Push

```text
H  Local commit not pushed yet                [newmu]
│
●  Previous remote head                       [origin/newmu]
│
●  Shared ancestor
```

This is the "needs push" state. The remote ref marker belongs on the older
commit where `origin/newmu` still points. Do not draw a remote lane up through
the local-only commit, because the remote ref does not contain it yet.

#### 4. Remote Branch Ahead Before Pull

```text
●  Remote commit not pulled yet               [origin/main]
│
●  Local head                                 [main]
│
●  Shared ancestor
```

This is the "needs pull" fast-forward state. Both refs are on the same topology
lane, but they point at different commits. The newer remote row gets the remote
ref marker; the older local row gets the local/current marker if it is selected.

#### 5. Diverged Local And Remote Before Pull Or Push

```text
●  Remote-only commit                         [origin/main]
│
│ H  Local-only commit                        [main]
│ │
│/
●  Shared ancestor
```

This is a real branch topology. Render the side lane because Git reports two
visible commit chains. Do not collapse it into ref markers only.

#### 6. Pull With Fast-Forward

Before:

```text
●  Remote commit                              [origin/main]
│
H  Local head                                 [main]
```

After:

```text
H  Remote commit                              [main] [origin/main]
│
●  Previous commit
```

Fast-forward pull does not create a merge node. The visual result is linear,
with both refs on the new head commit.

#### 7. Pull Or Merge Commit

```text
H    Merge origin/main into main              [main]
|\
| ●  Remote-side commit                       [origin/main]
| │
● │  Local-side commit
|/
●    Shared ancestor
```

This is a merge commit with two parents. Preserve Git's continuation rows, such
as `|\`, `|/`, or `| |/`, so the merge bend is drawn from Git's graph output.
The UI must not create a custom curve from the merge message alone.

#### 8. Feature Branch Merged By Pull Request

```text
●    Merge pull request #26 from puppyone-ai/ollie  [origin/main]
|\
| ●  Feature commit                                [origin/ollie]
| │
● │  Main commit before merge
|/
●    Shared ancestor
```

This is visually the same topology class as a local merge, but the row labels
come from remote refs and commit metadata. The graph should show the feature
lane only while feature commits are visible. Once the feature branch ref points
at a commit already on the main lane, it becomes a ref marker.

#### 9. Rebase

Before rebase:

```text
●  main commit                                  [origin/main]
│
│ ●  feature commit B                           [feature]
│ ●  feature commit A
│/
●  old base
```

After rebase:

```text
●  feature commit B'                            [feature]
│
●  feature commit A'
│
●  main commit                                  [origin/main]
│
●  old base
```

Rebase rewrites commits and usually removes the merge lane from the visible
future history. Do not preserve the old side lane unless those old commits are
still reachable from visible refs.

#### 10. Multiple Refs On One Commit

```text
●──▣  Release checkpoint                        [origin/main] [release] [backup/main]
│
●    Previous commit
```

When multiple non-current refs point at the same commit, use a grouped ref
marker, not a row of tiny unrelated dots. If several refs share the same visual
class, show a count marker such as `[remote x3]` in the graph and individual
labels in the row.

#### 11. Remote-Only Branch

```text
●──▣  Remote branch head                        [origin/ollie]
│
●    Shared history
```

Remote-only branches are still branches. If their head commit is visible, show
the remote ref marker and label. Do not require a local branch to exist before
the ref appears.

#### 12. Branch Head Outside The Visible Commit Window

```text
visible commit graph:
H  current work                                [newmu]
│
●  recent work

ref-only overflow:
▣  old-release -> 9ab12cd                      outside visible history
▣  experiment-x -> 1c90efa                     outside visible history
```

The branch must not silently disappear. If its head commit is outside the
visible all-branches history window, render it in a separate unresolved/ref-only
area or expand the all-branches window. It should not be forced into the commit
graph as a fake lane.

#### 13. Dense VSCode-Style Multi-Lane History

```text
H      Update desktop cloud and editor surfaces       [newmu] [origin/newmu]
│
●      desktop v0.0.1
│
│ ●    Qubits (#1317)                                [origin/main]
│ |\
│ │ ●  Fix frontend editor package deployment (#1316) [origin/qubits]
│ │ |\
│ | |/
|/| |
● │ │  Fix frontend editor package deployment
│ ● │  Qubits (#1315)
│ |\|
│ │ ●  Newmu (#1314)
│ │ |\
│ | |/
|/| |
● │ │  Update desktop data editor workspace
● │ │  updated desktop
│ │ ●  chore: checkpoint workspace changes (#1313)
│ │ |\
│ | |/
|/| |
● │ │  chore: checkpoint workspace changes
│ │ ●  Newmu (#1312)
│ │ |\
│ | |/
|/| |
● │ │  Merge remote-tracking branch 'origin/qubits' into newmu
|\ \ \
● │ │ │ Finalize MCP runtime and access surface cleanup
● │ │ │ feat: refine access workspace surfaces
│ │ │ ● Feat/context entrypoints (#1311)
│ │ │/│
│ │/│ │
```

This is the baseline for "complex enough" rendering. The UI should look like a
compact Git graph: lanes can open, cross, merge, and compact as Git reports.
It must not degrade into one long blue lane plus isolated ref markers, and it
must not draw full-height parallel lanes for refs that are not active in that
part of history.

#### 14. Stacked Pull Requests Into A Release Branch

```text
●    Release branch checkpoint                   [release/desktop]
|\
| ●  PR #103 feature commit                      [origin/feature/editor]
| │
● │  PR #102 merged into release
|\
| ●  PR #102 feature commit                      [origin/feature/cloud]
| │
● │  PR #101 merged into release
|/
●    Release base                                [origin/main]
```

Render repeated short side lanes. Each PR opens a lane only for its visible
feature commits and merge continuation. Do not keep old PR lanes alive after
Git compacts them.

#### 15. Nested Feature Branch

```text
●      Merge feature/search into feature/editor   [feature/editor]
|\
| ●    Search polish                              [feature/search]
| │
| ●    Search prototype
│/
●      Editor base work
│
●      Mainline base                              [origin/main]
```

A branch can be based on another branch, not only on main. The graph should
show the nested side lane relative to its actual base. Do not redraw it as if
every feature branch started from `origin/main`.

#### 16. Backmerge From Main Into A Feature Branch

```text
●    Merge origin/main into feature/editor        [feature/editor]
|\
| ●  Main hotfix                                  [origin/main]
| │
● │  Feature work before backmerge
│/
●    Shared base
```

Backmerge is a merge into the feature branch, not a feature merge into main.
The commit row label and current/ref labels decide the product meaning; the
graph remains the ordinary two-parent merge topology.

#### 17. Feature Merged, Branch Ref Deleted

```text
●    Merge pull request #42 from feature/editor   [origin/main]
|\
| ●  Feature commit B
| ●  Feature commit A
|/
●    Previous main
```

If the feature branch ref was deleted after merge, keep the historical topology
because the commits are still reachable through the merge. Do not show a
feature ref marker or label if no ref currently points there.

#### 18. Squash Merge

```text
●  Squash merge feature/editor (#42)              [origin/main]
│
●  Previous main

ref-only overflow, if the original feature branch still exists:
▣  feature/editor -> 91c2ab0                      not ancestor of squash commit
```

A squash merge creates a new linear commit on the target branch. The original
feature commits are not parents of the squash commit. Do not draw a side lane
from the squash commit unless those original commits are still visible through
their branch ref.

#### 19. Revert A Merge

```text
●  Revert "Merge pull request #42"                [origin/main]
│
●    Merge pull request #42 from feature/editor
|\
| ●  Feature commit B
| ●  Feature commit A
|/
●    Previous main
```

Revert is a normal linear commit. It should not erase the earlier merge
topology from history, and it should not create a synthetic branch lane.

#### 20. Cherry-Pick Across Branches

```text
●  Fix copied to release branch                   [release/desktop]
│
●  Release maintenance
│
│ ●  Original fix on main                         [origin/main]
│ │
│ ●  Main work
│/
●  Old shared base
```

Cherry-pick duplicates a patch as a different commit. Similar messages or file
changes do not imply a graph connection. Only Git ancestry should create lanes.

#### 21. Force-Push After Rebase

Before fetch:

```text
●  Old feature commit B                           [feature] [origin/feature]
│
●  Old feature commit A
│
●  Base
```

After remote force-push and fetch:

```text
●  Rebased feature commit B'                      [origin/feature]
│
●  Rebased feature commit A'
│
●  New base                                       [origin/main]

ref-only overflow, if local branch still points at old commits:
▣  feature -> old-b                               divergent local ref
```

Do not join old and new histories with a fake line. If both refs remain
reachable, show two separate histories according to Git. If the old local head
is outside the visible graph, show it as ref-only.

#### 22. Tag And Release Ref On A Commit

```text
●──▣  desktop v0.1.0 release                      [tag:v0.1.0] [origin/main]
│
●    Previous main
```

Tags and release refs behave like branch refs for display purposes, except they
are not current branches and should not create lanes. Group them with other
refs when they point at the same commit.

#### 23. Detached Head

```text
H  Temporary inspection commit                    [detached]
│
●  Known branch head                              [origin/main]
│
●  Earlier commit
```

Detached `HEAD` is a workspace state, not a branch ref. Show the `H` marker on
the checked-out commit, and show real refs separately if they point at the same
or nearby commits.

#### 24. Many Remote-Only Branch Heads Outside The Commit Graph

```text
visible commit graph:
H  current work                                  [newmu]
│
●  recent work

ref-only overflow:
▣3 origin/old-release, origin/staging, origin/prod-backup
▣2 origin/research-a, origin/research-b
▣  origin/one-off-fix
```

When the repo has many old remote-only branches, group ref-only rows by commit
and visual class. The graph should stay readable; do not append hundreds of
tiny disconnected dots. A future UI may add filtering, but until then the data
model must preserve those refs instead of dropping them.

### Product Rules

- The graph answers "how commits relate"; labels and ref markers answer "which
  branch names point here."
- A branch is visible as a topology lane only while it has visible commits or
  Git continuation rows distinct from the current lane.
- A branch whose head is an existing visible commit is visible as a ref marker,
  not as a synthetic full-height lane.
- A branch whose head is outside the visible history must still be represented
  as a ref-only item; branch refs should not vanish because of pagination.
- Ref markers should be visually stronger than a tiny dot: they need a short
  connector and a marker sized to read as "branch head", while remaining
  secondary to real commit nodes.
- The right-side row label is not enough by itself. The left graph must also
  show that a ref exists on that commit.
- Commit messages such as "merge", "pull", "rebase", "cherry-pick", or
  "revert" are metadata only. They may influence labels, but only Git ancestry
  may create topology lanes.
- Deleted branch refs must not be shown as current refs, but their commits stay
  in the graph if reachable.
- Squash, cherry-pick, and revert are linear graph operations unless Git
  ancestry says otherwise.
- Multiple refs pointing at the same commit should be grouped by visual class;
  avoid drawing one tiny marker per ref when the row already contains labels.

### Invariants

- Git graph topology comes from `git log --graph`, not from a custom React lane
  state machine.
- Continuation rows emitted by Git are preserved; dropping them causes merge
  curves and lane compaction to break.
- The all-branches history window must be larger than the current-branch
  history window, otherwise older branch heads disappear before the UI can
  label or mark them.
- Branch refs that share a commit line still need visible ref markers.
- Commit rows remain the only interactive rows. Graph-only continuation rows are
  presentational.
- The Branches section may change colors, density, or labels, but must keep the
  data-source boundary above.

## Smooth Preview Transitions

### Problem

The desktop file preview used to flash a blank or white frame during file
switches. The visible sequence was:

1. The sidebar selection changed immediately.
2. The previous editor was unmounted.
3. The next file content was loaded asynchronously through the Electron bridge.
4. A new editor host was committed before the editor instance was ready.
5. CodeMirror or the viewer mounted on a later effect pass.

This made page switching feel unstable, especially for Markdown documents where
CodeMirror owns a large DOM subtree.

The root cause was not route-level lazy loading. It was a lifecycle boundary
problem: selection state, content loading state, and editor instance state were
coupled too tightly.

### Design Goal

File switching must feel continuous. The main preview area should never expose an
empty editor host simply because a new selection is pending. The UI may show a
loading state, but it must be deliberate, background-matched, and tied to a
document lifecycle.

### Final Architecture

The desktop preview path uses three separate concepts:

- Selection intent: the file currently selected in the sidebar.
- Loaded content: the latest content known for a path.
- Committed preview document: the document currently safe to render in the main
  editor surface.

When a user selects a new file, the sidebar selection may update immediately, but
the main editor only switches to that file when the file has enough data to
render. If the selected file is still pending and a previous document is already
committed, the main editor keeps rendering the previous committed document.

This avoids the unstable state where React switches to a new document path before
the document content and editor instance are ready.

### Implementation Rules

1. Do not let selection state directly unmount the editor.

   `activePath` is an input signal, not proof that the editor can render the
   selected document. The render path must go through a committed preview state.

2. Keep a content cache by file path.

   Once a file has been read, switching back to it should use cached content
   immediately while the system refreshes in the background.

3. Do not use `key={document.path}` to reset text editors.

   Forced remounts create blank-frame windows and discard editor state too
   aggressively. Text editors receive an explicit `documentId` and reset their
   local draft/save state in layout phase.

4. Initialize DOM-owned editors before paint.

   CodeMirror setup and content reconfiguration must run in `useLayoutEffect`
   so the browser does not paint an empty host before the editor DOM is attached.

5. Bind saving to the rendered document, not the selected document.

   During a pending selection, the main area may still render the previous
   committed document. Save callbacks must write to the document currently being
   rendered, not whichever file is currently highlighted in the sidebar.

6. Scope errors by document path.

   A read error from one path must not leak into another path during rapid file
   switching.

### Current Code Boundaries

- `frontend/shared-ui/src/data/DataWorkspace.tsx`
  - owns selected file resolution
  - owns file content cache
  - owns committed preview document state
  - binds save callbacks to the rendered document

- `frontend/shared-ui/src/data/FilePreview.tsx`
  - renders the current preview shell
  - avoids fallback preview content while full content is pending

- `frontend/shared-ui/src/editor/viewers/TextEditorFrame.tsx`
  - owns text editor draft, persisted content, save state, and mode state
  - resets by `documentId` without forcing a React remount

- `frontend/shared-ui/src/editor/markdown/MarkdownCodeMirrorEditor.tsx`
  - owns the CodeMirror `EditorView`
  - mounts and reconfigures in layout phase
  - updates content through CodeMirror transactions

The desktop app consumes these shared UI files through
`desktop/vendor/shared-ui`. After changing shared UI, run:

```bash
node scripts/sync-desktop-shared-ui.mjs
```

### Verification

For this feature, the minimum verification is:

```bash
cd desktop
npm run check:shared-ui
npm run build
```

Manual verification should cover:

- rapidly switching between Markdown files
- switching between files already visited and files not yet cached
- switching while a file is autosaving
- switching to a file that fails to read
- switching between Markdown, plain text, JSON, CSV, image, PDF, and HTML

### Invariants

These invariants should remain true after future changes:

- A selected sidebar row does not guarantee that the main editor has switched.
- The main editor always renders a committed document or a deliberate empty state.
- No viewer should show an unstyled browser-white fallback during normal
  transitions.
- Text editors reset by document identity, not by React subtree destruction.
- Autosave must never write old document content to a newly selected path.

## Sidebar Explorer Tree Lifecycle

### Problem

The desktop explorer sidebar can display multiple view modes in the same column:
the file tree for the data view, and custom sidebar surfaces for Git, Cloud, and
Settings. The file tree also lazy-loads folder children.

Two unstable behaviors can appear if these lifecycle boundaries are mixed:

1. A folder's first expansion animates to a single loading row, then jumps to the
   final multi-row height after children arrive.
2. Switching from another desktop tab back to the data view replays expansion
   animations for folders that were already open.

Both are architecture problems, not animation tuning problems. The tree cannot
infer whether a visible subtree is a fresh user expand, a restored already-open
subtree, or a lazy-load completion if data state, view lifecycle, and animation
presence are all coupled in one component.

### Design Goal

The sidebar file tree must behave as a stable controlled view:

- Folder expansion state survives tab switches.
- First-time folder loading does not animate through an intermediate loading
  height.
- User-initiated expand/collapse still animates.
- Returning to the data tab does not replay existing expansion animations.
- Tree guide lines are rendered at subtree scope so each indentation level
  extends through its full child group.

### Final Architecture

The explorer path uses four separate concepts:

- Data loading state: which folders have children loaded and which folders are
  currently loading.
- Expansion state: which folder paths are logically expanded.
- View lifecycle: whether the files sidebar surface or a custom sidebar surface
  is currently active.
- Motion lifecycle: whether a subtree is initially present or is transitioning
  because expansion changed after mount.

`DataWorkspace` owns data loading and expansion state. `ExplorerTree` receives
`expandedPaths` and `loadingPaths` as controlled props and renders rows from
those props. It does not own canonical folder expansion state.

The sidebar column uses a keep-alive view stack. The files explorer frame remains
mounted while Git, Cloud, or Settings sidebars are active. Inactive frames are
hidden with `visibility: hidden` and `pointer-events: none`, not unmounted and
not `display: none`. This preserves layout measurements and avoids treating tab
return as a fresh tree mount.

Subtree animation is split into a presence layer and a motion layer:

- `ExplorerSubtreePresence` decides whether a subtree should remain mounted
  during enter/exit.
- `ExplorerSubtreeMotion` animates only transitions that occur after initial
  presence has committed.

This is equivalent to the common motion rule `initial={false}`: initial render
represents current state; subsequent state changes animate.

### Implementation Rules

1. Do not store canonical expansion state inside `ExplorerTree`.

   Expansion is workspace state because it must survive view switches, lazy
   loading, and active-path auto-expansion. Keep it in `DataWorkspace` and pass
   it down as `expandedPaths`.

2. Load unloaded folders before marking them expanded.

   For folders without loaded children, `DataWorkspace` must call
   `dataPort.listChildren(folderPath)` and attach the children before adding the
   folder path to `expandedFolderPaths`. This prevents expansion animation from
   measuring a temporary one-row loading placeholder and then stretching to the
   real content height.

3. Treat root loading separately from empty root state.

   The root folder has no path, so loaded/empty state must not be inferred from
   `tree.length`. Use explicit root-loaded state so an empty root can be a stable
   loaded state.

4. Keep the files explorer view mounted across sidebar tab switches.

   Git, Cloud, and Settings may replace the visible sidebar content, but they
   must not destroy the files tree subtree. Use the view stack contract instead
   of conditional rendering that swaps the tree out.

5. Do not use `display: none` for inactive explorer frames.

   `display: none` removes layout and invalidates measured heights. Hidden
   frames should retain geometry with `visibility: hidden` plus disabled pointer
   events.

6. Keep presence and motion separate.

   Row rendering should not guess whether an expansion is a user action, a tab
   restore, or an initial render. Presence owns mount/exit retention; motion
   owns height measurement and animation.

7. Initial subtree presence must not animate.

   If a subtree is already expanded when it first appears in the mounted tree,
   render it at `height: auto`. Only expansion or collapse after that mounted
   presence should animate.

8. Draw indentation guides at subtree scope.

   Per-row guide lines create broken vertical guides. The guide for a level
   belongs to the subtree content wrapper so it can extend through all rendered
   descendants.

### Current Code Boundaries

- `frontend/shared-ui/src/data/DataWorkspace.tsx`
  - owns `expandedFolderPaths`
  - owns `loadingFolderPaths`
  - owns root loaded state and load generation
  - loads folder children before expanding unloaded folders
  - renders the keep-alive explorer view stack

- `frontend/shared-ui/src/data/ExplorerTree.tsx`
  - receives `expandedPaths` and `loadingPaths`
  - renders the controlled tree
  - owns transient drag/drop UI state only
  - contains subtree presence and motion helpers

- `frontend/shared-ui/src/styles/data-workspace.css`
  - defines the keep-alive explorer frame stack
  - defines subtree-level guide lines
  - preserves inactive frame layout without pointer interaction

The desktop app consumes these shared UI files through
`desktop/vendor/shared-ui`. After changing shared UI, run:

```bash
node scripts/sync-desktop-shared-ui.mjs
```

### Verification

For this feature, the minimum verification is:

```bash
cd desktop
npm run check:shared-ui
npm run check:boundaries
npm run build
```

Manual verification should cover:

- expanding a never-loaded folder with multiple children
- expanding and collapsing an already-loaded folder
- switching from Data to Git and back after several folders are expanded
- switching from Data to Cloud and Settings and back
- selecting a deep file path that auto-expands ancestor folders
- verifying subtree guide lines are continuous through nested folders

### Invariants

These invariants should remain true after future changes:

- `ExplorerTree` is a controlled renderer for expansion state.
- Folder loading and folder expansion are separate states.
- An unloaded folder is not marked expanded until its children have been attached.
- The files explorer remains mounted across desktop sidebar tab switches.
- Inactive explorer frames preserve layout geometry.
- Initial subtree presence does not animate; post-mount expansion/collapse does.
- Tree guide lines are subtree-scoped, not row-scoped.

## Desktop Auto Update Lifecycle

### Problem

PuppyOne Desktop needs a cloud-delivered update system that feels like modern
developer tools: the app detects that a new version exists, shows a small update
signal, and lets the user update from inside the app without manually finding a
download page or mounting a new installer.

This must not be implemented as an ad hoc downloader. Desktop application
updates are security-sensitive because they replace executable code on the
user's machine. The update path must be signed, reproducible, observable, and
controlled by release metadata rather than by renderer-side download logic.

### Design Goal

The update experience should support one-click update:

- The app checks for updates automatically in the background.
- The user sees an update badge or settings row when a version is available.
- Clicking `Update now` authorizes the full update flow: check if needed,
  download if needed, install, and restart.
- The user never needs to open a browser, download a DMG manually, or drag an
  app bundle into Applications.
- If the app cannot safely restart, the same update flow pauses on a clear
  blocker instead of silently quitting with unsaved work or active local
  processes.

### Final Architecture

Use `electron-builder` and `electron-updater` as the update stack.

The cloud side publishes signed release artifacts plus update metadata. The app
does not ask PuppyOne API endpoints for executable binaries directly. It asks
the updater feed for the latest release metadata, and `electron-updater`
downloads and validates the artifact described by that metadata.

The update path has five layers:

- Release artifacts: signed and notarized app packages built by CI.
- Release metadata: `latest.yml`, `latest-mac.yml`, and platform-specific
  metadata generated by electron-builder.
- Publish host: a public HTTPS update origin such as S3/R2 plus CDN, or another
  electron-builder-supported provider.
- Main-process update service: the only code allowed to import and control
  `electron-updater`.
- Renderer UI: a badge, progress state, and a single `Update now` command
  exposed through typed IPC.

The production stable macOS feed is:

```text
https://updates.puppyone.ai/desktop/stable/mac
```

Cloudflare R2/CDN should use platform-scoped channel directories:

```text
desktop/
  stable/
    mac/
      latest-mac.yml
      puppyone-<version>-arm64.dmg
      puppyone-<version>-arm64-mac.zip
    windows/
    linux/
  beta/
    mac/
    windows/
    linux/
  internal/
    mac/
    windows/
    linux/
```

For macOS, the production release must be Developer ID signed and notarized.
The mac target must include `zip` in addition to `dmg`, because the updater
metadata for macOS depends on the zip artifact. The current development config
with unsigned builds is not a production auto-update configuration.

Official updater constraints to preserve:

- electron-builder auto updates use `electron-updater`, release artifacts, and
  generated update metadata such as `latest.yml` / `latest-mac.yml`.
- macOS auto updates require a signed application.
- macOS updater metadata requires a zip artifact in addition to a DMG artifact.
- For new projects, set `electronUpdaterCompatibility` to a current metadata
  compatibility range such as `>= 2.16`.
- Generic HTTP/S update hosting is valid, but artifact and metadata upload must
  be handled by the release pipeline.

### One-Click Update Flow

The renderer exposes one primary action: `Update now`.

That action calls a single main-process command, for example
`updates.updateNow()`. The renderer must not decide whether to check, download,
or install. The main-process update service owns the full state machine:

1. If the current state is `idle`, `not-available`, or `error`, call
   `checkForUpdates()`.
2. If an update is available and not downloaded, call `downloadUpdate()`.
3. While downloading, stream progress to the renderer.
4. When the update is downloaded, run the restart preflight.
5. If preflight passes, call the updater install/restart operation.
6. If preflight fails, transition to `blocked` with explicit blocker details.

The click is still one user action. A blocker is not a second update decision;
it is a safety stop. After the blocker is resolved, the same command resumes
from the downloaded state and installs immediately.

### Update State Machine

The update service owns a serial, idempotent state machine:

- `disabled`: updater is unavailable, usually because the app is unpackaged,
  unsigned, or running in a development mode without a configured dev update
  feed.
- `idle`: no update work is in progress.
- `checking`: the app is querying the update feed.
- `not-available`: the latest version for this channel is already installed.
- `available`: update metadata is known, but the artifact is not downloaded.
- `downloading`: an artifact download is in progress.
- `downloaded`: the artifact is downloaded and ready to install.
- `installing`: the app is quitting and handing control to the updater.
- `blocked`: the update is ready, but install is waiting for an app-owned safety
  condition.
- `error`: the last operation failed.

The state machine must be idempotent. Repeated clicks on `Update now` while an
operation is already running should return the current state or the in-flight
promise, not start duplicate checks or downloads.

### Restart Preflight

One-click update must not mean unsafe quit.

Before calling the updater install/restart operation, the main process must ask
the app whether it is safe to restart. The preflight should check:

- active editor saves or dirty documents
- in-flight filesystem writes
- running terminal sessions or local subprocesses
- active sync/publish/pull/push operations
- modal flows that are currently committing user input

If everything is safe, install immediately. If not, show a compact blocker UI
with the exact reason, such as `Finish the active terminal command before
restarting`. Once the blocker clears, `Update now` should continue from
`downloaded`; the user should not need to download again.

### Product Behavior

The app should check for updates after startup with a short delay, then on a
bounded schedule such as every few hours while the app is running. It should
also expose a manual `Check for updates` action in Settings.

Background checks may discover an update, but they should not interrupt normal
work with a modal. The default UI should be a titlebar badge or Settings row.

The primary action text must be explicit:

- `Update now` when an update can be downloaded and installed.
- `Downloading update` while progress is active.
- `Restarting to update` during install.
- `Resolve blocker to update` if preflight is blocked.

For normal releases, the app should not automatically restart without a user
action. For security-critical or minimum-version releases, the backend may mark
the update as required, but the client still routes through the same preflight
and blocker model.

### Release Channels

The update feed must be channel-aware:

- `stable`: default for normal users.
- `beta`: opt-in early access.
- `internal`: team-only builds.

Each channel has its own update metadata path. Do not mix channel artifacts
under a single metadata file. A stable client should never see an internal or
beta release unless the user or build explicitly opts into that channel.

Staged rollout should be controlled through update metadata, not through random
client decisions on every check. A user assigned to a rollout bucket must remain
stable across checks.

### Publish Pipeline

CI owns production publishing:

1. Bump `desktop/package.json` version.
2. Build renderer and Electron bundle.
3. Sign the app.
4. Notarize macOS artifacts.
5. Generate updater artifacts and metadata.
6. Upload artifacts to the platform channel directory, for example
   `desktop/stable/mac/`.
7. Upload the `latest*.yml` metadata last.

Metadata is the release switch. Uploading metadata before all artifacts are
available can make clients discover a release they cannot download.

Broken releases should be fixed by publishing a higher version. Do not attempt
to "replace" a bad version in place after clients may already have seen it.

### Implementation Rules

1. Keep updater control in the Electron main process.

   Renderer code may request actions through IPC and subscribe to state changes,
   but it must not import `electron-updater`, download binaries, or run
   installers.

2. Use one command for the product action.

   `Update now` should map to one IPC command that drives check, download, and
   install according to the current state.

3. Keep automatic checks separate from automatic install.

   Background checks can update UI state. Installation must follow user intent
   unless a future required-update policy explicitly says otherwise.

4. Disable duplicate updater operations.

   The update service must serialize checks/downloads/installs. Multiple clicks
   or multiple windows must not start parallel downloads.

5. Persist enough update state for restart-safe UX.

   If an update has been downloaded, the UI should restore to a ready-to-install
   state after renderer reloads, as long as the updater still reports the
   downloaded artifact as valid.

6. Log updater events from main.

   Use a main-process log sink for updater events and errors. Update failures
   should be diagnosable without renderer console access.

7. Keep production updates signed.

   Unsigned builds may be used for local development, but they are not a valid
   production update channel.

8. Make unsupported modes explicit.

   Development, unpackaged, unsigned, or unsupported-platform runs should report
   `disabled` rather than showing a broken update button.

### Current Code Boundaries

- `desktop/package.json`
  - owns electron-builder targets and publish configuration
  - must include macOS `zip` for production auto-update support
  - must switch production macOS builds from unsigned development settings to
    signed and notarized settings

- `desktop/electron/main.mjs`
  - initializes the update service after `app.whenReady()`
  - wires app-level restart preflight checks

- `desktop/electron/update-service.mjs`
  - owns `electron-updater`
  - owns the update state machine
  - serializes update operations
  - emits update state to renderer windows
  - exposes one-click `updates:update-now` semantics through IPC

- `desktop/electron/preload.cjs`
  - exposes typed update IPC methods under the desktop bridge

- `desktop/src/*`
  - renders update badge, progress, and Settings actions
  - never imports updater packages directly

Runtime controls:

- `PUPPYONE_DESKTOP_UPDATE_CHANNEL`
  - `stable`, `beta`, or `internal`
  - defaults to `stable`
- `PUPPYONE_DESKTOP_UPDATE_URL`
  - optional generic-provider feed override for packaged builds
- `PUPPYONE_DESKTOP_DEV_UPDATE_URL`
  - optional generic-provider feed for local updater testing
  - enables dev updater config forcing
- `PUPPYONE_DESKTOP_FORCE_DEV_UPDATE_CONFIG=1`
  - explicitly allows updater checks in development mode

Build scripts:

- `npm run dist:mac`
  - local unsigned mac artifact build for development verification
  - builds both DMG and zip targets
- `npm run dist:mac:publish`
  - CI production publish path
  - expects signing, notarization, and publish credentials from CI environment

### Verification

For this feature, the minimum verification is:

```bash
cd desktop
npm run build
npm run dist:mac
```

Manual verification should cover:

- no-update check on the latest stable version
- update available from an older packaged version
- one-click `Update now` from available state
- one-click `Update now` while no prior check has been run
- progress reporting during download
- downloaded update installing and restarting
- blocked restart when editor save, terminal, or sync work is active
- resuming install after blocker clears
- update check disabled in unsupported development mode
- bad metadata or missing artifact producing a visible error state

### Invariants

These invariants should remain true after future changes:

- Production desktop updates use signed artifacts and updater metadata.
- The renderer never downloads or executes update artifacts directly.
- `Update now` is one product command, even if internally it checks, downloads,
  and installs.
- Main process owns updater state and updater side effects.
- Restart preflight protects unsaved or active local work.
- Release metadata is uploaded after artifacts.
- Channels are isolated by update metadata path.
