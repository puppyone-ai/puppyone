# Data Feature Contract

This file records product and engineering agreements for the Data page.
When a Data sidebar or Data workspace interaction changes, update this
contract in the same patch.

## Sidebar Folder Creation

- Clicking a folder `+` creates a single pending row in that folder.
- The pending row is a closed folder row. It must not auto-expand.
- The pending row label is loading copy (`Creating folder`) rather than the
  final folder name.
- The pending row shows a subtle inline loading indicator.
- The pending row is inert: it does not navigate, expand, accept drops, or show
  row actions.
- After the backend create succeeds, the pending state is removed and the row
  displays the real folder name from the canonical directory cache.
- If the backend create fails, the optimistic row is removed and the parent
  directory cache is refreshed.

## Sidebar Folder Rows

- Folder rows in the sidebar are disclosure controls first.
- Sidebar tree folder rows use a small light-blue folder glyph. Collapsed and
  expanded folders may use different glyph shapes, but the row still reads as a
  folder, not a standalone chevron control.
- A normal click anywhere on a folder row toggles expand/collapse.
- Folder row click must not navigate or activate the main workspace.
- File rows remain the navigation/open action.
- Row action buttons such as `+` and `...` are separate controls and must not
  also toggle the folder row.

## Folder Commands

- The project-level `Access` button belongs at the far right of the Data
  header and is not tied to the currently focused file or folder. It must open
  modal-owned Access surfaces, not route the user into the right sidebar:
  one existing access point opens its quick modal, multiple existing access
  points open an overview modal, and zero access points opens the create modal.
- Header actions operate on the current workspace object, not an arbitrary
  sidebar disclosure row.
- Sidebar folder rows have two creation/command hover actions at most: `...`
  for object commands and `+` for creating children.
- These hover actions are positioned as an absolute right-side action layer
  inside the row. They do not participate in the row text flex layout and must
  not make folder names resize on hover.
- The row `...` menu operates on that exact sidebar item without selecting it.
  It may contain `Rename`, `Expose as...` / `Manage Access`, `Download`, and
  `Delete`.
- Access creation/Expose lives in the row object menu for an exact sidebar
  folder and in the header for the current main workspace folder.
- Configured Access is a persistent status/action inside the row itself. Show a
  slightly stronger Access icon button at the far right of the row action layer,
  to the right of `+`, so users can see which folders already have Access.
- Folders without configured Access do not show an Access button, rail marker,
  hover bubble, tooltip-like card, numeric badge, or extra right-side strip.
- The top-level header Access button stays visible as the discoverable project
  access surface; the header `...` menu can expose the current folder directly.

## Sidebar Tree Motion

- Folder subtree expand/collapse should keep the smooth vertical content motion:
  children are clipped in/out by measured height while surrounding rows are
  pushed by layout.
- This motion is for the subtree content, not a chevron/icon animation. The
  light-blue folder glyph may switch between closed/open shape, but do not bring
  back a standalone rotating chevron as the primary folder affordance.
- Open ancestors should settle back to `height: auto` after their own transition
  so nested folder expansion pushes outside siblings continuously instead of
  serializing inner and outer movement.
- Long term, the cleanest tree-motion architecture is a flat visible-row model:
  derive the rendered rows from expansion state, then animate inserted/removed
  row ranges from one layout owner. Do not add more independent recursive
  animation wrappers unless there is a clear local reason and it is tested on
  deeply nested folders.

## Data Route Navigation

- Selecting a file changes the URL and editor target, but must not remount or
  refetch the left explorer sidebar.
- The explorer sidebar lifecycle is driven by project/content refresh events,
  not by ordinary file selection.
- Sidebar, grid, Miller-column item, and Data breadcrumb clicks should update
  Data's client route state and browser URL together. Avoid `router.push` for
  routine in-page Data item selection when it would remount `[[...path]]/page.tsx`
  and collapse/replay the sidebar tree.
- Browser back/forward must still restore the Data route state from the URL.

## Access Panel Overview

- The Access overview represents project-wide active access points, not files.
- The list heading is `Active access points`; do not use engineering language
  such as `Access scopes` in user-facing copy.
- Each overview row must stay compact, preferably two information lines:
  scope/folder name with active connector chips, then path with active connector
  summary, plus a chevron that makes the row's drill-down behavior clear. Do
  not show permission labels such as `Read & Write` or redundant object labels
  such as `Scope` in the row.
- The Access sidebar overview uses at most three text sizes: `13px` for titles
  and section labels, `12px` for body/path/connector summaries, and `11px` for
  compact connector chips or other metadata. Keep weights to the shared
  hierarchy (`600`, `500`, `400`) instead of ad hoc per-component styling.
- Clicking an access point row opens the access point detail page. It must not
  navigate the file tree.
- The Access overview's create action is the page-level primary CTA in the
  header (`New access point`), not a weak card hidden below the active list.
  The sidebar may provide create entry points, but it must not own a second
  create form, loading state, or validation path.
- The Access create modal is the original two-pane create flow: the left pane
  browses Files and chooses a folder boundary, and the right pane shows folder
  details plus included/optional methods before the footer `Create access`
  action submits.
- Adding a SaaS/integration connector from an Access scope uses the shared
  integration-create modal. It must not replace the Access sidebar body with a
  `sync_create` page.

## Active vs Status

- Active/selected styling has one source of truth: route or explicit selection.
- Creating, syncing, importing, access hover, and other transient states are
  status feedback, not selection.
- A status row must not reuse active selection styling in a way that makes two
  sidebar elements look selected at once.

## Event Boundaries

- Sidebar row actions own their pointer/click isolation. A click on `+`, `...`,
  or a menu item must not also activate the row underneath it.
- Menu triggers such as `...` should stop propagation without preventing the
  browser's default pointer/click sequence. Preventing default on pointer down
  can make the menu fail to open in some event paths.
- Popover menu items must stop pointer/click propagation at the menu boundary.
- Row menus must render through a body-level portal. The explorer tree uses
  animated wrappers with `overflow: hidden` and transforms; inline fixed menus
  can be clipped or trapped by those ancestors, especially for nested rows.
- Callers should not need to remember ad hoc `stopPropagation` for standard
  row actions.
