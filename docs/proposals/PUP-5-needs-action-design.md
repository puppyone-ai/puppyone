# PUP-5 — Changes page "Needs Action" workflow design

**Status:** ✅ decisions locked, ready for implementation
**Last updated:** 2026-05-24

This is a design + scope doc, not an implementation plan. Implementation
starts only after §6 decisions are locked.

---

## 1. Current state (audit)

The route in question is [`frontend/app/(main)/projects/[projectId]/history/page.tsx`](../../frontend/app/(main)/projects/[projectId]/history/page.tsx). Despite the URL saying `history`, this IS the Changes page — the issue refers to its product surface.

**Layout today** (two columns inside the (main) shell):

```
┌─ History sidebar (resizable 260–520px) ──┐ ┌─ Commit detail pane ────────┐
│  Filters: [scope ▾] [actor ▾]            │ │  message · who · time       │
│  ─────────────────────────────────────   │ │                             │
│  ● a82f19c   Agent   2m ago     HEAD      │ │  Changed files              │
│  ● b77c04a   User    18m ago              │ │   M notes/client.md         │
│  ● 91dd2ab   Sync    1h ago               │ │   A drafts/proposal.md      │
│  …                                        │ │  Diff view                  │
│                                           │ │  Conflicts on this commit   │
└───────────────────────────────────────────┘ └─────────────────────────────┘
```

Components: `VerticalCommitNode` rows, `ResizableSidebarColumn`, `CommitDetail` right pane.

**What backend data is already available** (full audit in §6):
- `listPendingConflicts(project_id)` → `mut_conflicts` rows with policy / resolver_kind / changed_paths / scope_path / created_at.
- `getPendingConflict(project_id, id)` → full conflict detail incl. base / current / client tree refs.
- `resolveConflict(project_id, id, {decision, resolution_tree_id | resolution_files})` → commits resolution.
- Commit history with actor classification (user / agent / sync).
- Project Git health (a separate health badge, useful as a peer signal).

**What backend data is NOT yet available** (gaps to fill or design around):
- **G1.** Failed sync queue. Sync jobs exist in the connectors layer but have no list endpoint exposed to the frontend.
- **G2.** Audit detail (file-count, operation-type metadata) is stored but not surfaced by the history API, so "risky delete: 50 files" cards have no data source today.
- **G3.** "Staged agent session awaiting review" — there is no backend primitive. Agents commit immediately; their commits are normal history rows. A genuine "agent session needs review before commit" requires a new draft/snapshot concept.

---

## 2. Product framing — what is `Needs action` for?

Three crisp questions every user should answer in under 2 seconds when they open the page:

1. **Is anyone blocked on me?** (count of items, none = green).
2. **What's the most urgent thing?** (top item, ordered by severity × age).
3. **What can I just do? / What needs decisions?** (one-click actions vs. items requiring a resolution flow).

`History` is the **cold record** — chronological, immutable, browse-only. `Needs action` is the **hot work queue** — finite, drains as items get resolved, never grows without bound.

This framing dictates the entire design:

- The Needs Action section must be **finite-feeling**. If the queue has 200 items the design has failed — we need filtering / collapsing / "show all".
- Items must have a **clear terminal state** so users feel the queue draining.
- The History timeline below must stay **unmodified** in default behaviour (no regressions for users who only care about the audit log).

---

## 3. Layout proposal

Reuse the existing two-column shell. Add Needs Action **inside** the existing sidebar, **above** the filters. Do not add a new global sidebar.

```
┌─ Changes sub-sidebar (260–520px, resizable) ───┐ ┌─ Detail pane ──────────────────┐
│                                                │ │                                │
│  Needs action            (2 collapsible)        │ │  ┌─ Pending review #c4e1 ────┐ │
│  ▾ Pending review   2                            │ │  │ scope: drafts/           │ │
│    [c4e1f7] drafts/    12 files · Agent · 2m   ●│ │  │ Agent claimed · waiting  │ │
│    [a92810] reports/    3 files · Manual · 30m  │ │  │ for human override       │ │
│  ▾ Conflicts        1                            │ │  │                          │ │
│    [d7710f] notes/X.md  3-way · You vs Sync     │ │  │  Files (12)              │ │
│  ▸ Failed sync      1                            │ │  │  [diff viewer]           │ │
│                                                  │ │  │                          │ │
│  ─────────────────────────────                  │ │  │  [Accept agent merge]    │ │
│                                                  │ │  │  [Reject & resolve...]   │ │
│  Filters:  [scope ▾]  [actor ▾]                  │ │  │  [Snooze 24h]            │ │
│                                                  │ │  └──────────────────────────┘ │
│  History                                         │ │                                │
│  ● a82f19c   Agent      2m ago     HEAD          │ │                                │
│  ● b77c04a   User       18m ago                  │ │                                │
│  ● 91dd2ab   Sync       1h ago                   │ │                                │
│  …                                                │ │                                │
└──────────────────────────────────────────────────┘ └────────────────────────────────┘
```

Visual rules:
- The Needs Action block has a **left accent border** (warning tone) and a faint background to read as "hot zone".
- Each group is collapsible. Group header shows kind + count. Hidden when empty.
- Items inside a group are tappable rows; tapping fills the right pane with that item's resolution view.
- The whole block disappears when there are zero items (no empty placeholder cluttering history users' page).
- Filters + History continue to live below, unchanged.
- Detail pane is a **shared real-estate**: selecting a Needs Action item shows its resolution view; selecting a history commit shows the existing CommitDetail. The two views share the same chrome (header, file-changes section) so users don't feel a context switch.

Why this layout:
- Matches the issue's structural sketch.
- One scroll surface, not two — keeps cognitive load down.
- Reuses every existing primitive (sidebar, detail pane, filter dropdowns, commit-row hover affordances).
- Implementation cost is contained because the History list / filters / detail pane components are reused.

---

## 4. Item-type taxonomy

The issue lists six possible item types. Cutting them to the minimum-shippable set keeps the v1 honest:

| Item type | Backend source (today) | Frontend status | v1 in scope? |
|---|---|---|---|
| **Pending review** (agent-claimed conflict awaiting human override) | `listPendingConflicts()` where `resolver_kind='agent' AND policy='agent_review'` | listable | ✅ ship |
| **Conflict** (manual_review, human must resolve) | `listPendingConflicts()` where `resolver_kind='human'` | listable | ✅ ship |
| **Failed sync** | gap G1 — no endpoint | not listable | ❌ defer to PUP-5-followup |
| **Risky delete / mass edit** | gap G2 — audit_detail not surfaced | not listable | ❌ defer (needs backend exposing audit_detail.changed_count) |
| **Plugin-specific resolver item** | resolver registry is 1-per-process today, no plugin shape | not pluggable | ⏳ design the extension point, no concrete plugin yet |
| **PR-like review unit** | no primitive (agents commit immediately, no "staged session") | unimplementable | ❌ defer to a separate ticket (needs new backend concept) |

**v1 ships two real categories** (pending review, conflict). Empty groups for the other categories are NOT rendered (no dead UI). The follow-ups (failed sync, risky delete, agent staged sessions) get tickets and slot into the same chrome when their data sources land.

### 4.1 Why split "pending review" from "conflict" at all?

They're both rows in `mut_conflicts`, but the user mental model differs:

- **Conflict** = "you and someone else changed the same thing. Decide which side wins, or do a 3-way merge."
- **Pending review** = "Claude (or another agent) already produced a merge proposal. You only need to glance and accept, or override."

Treating them as one bucket misses the UX win — a pending-review item is usually a one-tap accept, whereas a conflict is a sit-down-and-think task. Different buckets = different visual treatments (review item shows agent decision summary; conflict shows the three sides).

---

## 5. Detail-pane patterns per item type

Shared chrome (top of pane, both types):
```
┌─ <Kind chip>  <short id>  <scope path>  ··  <relative time>  [✕ close] ┐
```

### 5.1 Pending review (agent-claimed)

```
┌────────────────────────────────────────────────────────────────────┐
│  Pending review   #c4e1f7   scope: drafts/         · 2m ago        │
├────────────────────────────────────────────────────────────────────┤
│  Agent's proposal                                                   │
│   ▸ Combined your edits to client.md with the sync update.          │
│   ▸ Kept your version of proposal.md; sync had no changes.          │
│   ▸ Deleted archive/old.pdf as requested.                            │
│                                                                     │
│  Files in this review (12)                                          │
│   M notes/client.md         [+34/-12]   diff ›                      │
│   A drafts/proposal.md      [+89/-0]    diff ›                      │
│   D archive/old.pdf                      ─                           │
│   …                                                                 │
│                                                                     │
│  ┌─────────────────────┐  ┌─────────────────────┐  ┌──────────────┐ │
│  │ Accept agent merge  │  │ Reject & resolve... │  │ Snooze 24h   │ │
│  └─────────────────────┘  └─────────────────────┘  └──────────────┘ │
└────────────────────────────────────────────────────────────────────┘
```

Actions:
- **Accept agent merge**: hits `resolveConflict({decision: 'accept', resolution_tree_id: <agent's>})`. Item moves out of Needs Action, a normal history row appears showing the merge.
- **Reject & resolve...**: opens the manual conflict resolver inline. The agent's proposal becomes a third candidate in the merge UI.
- **Snooze 24h**: client-only (localStorage hide flag, expires 24h later) — does NOT touch backend. Lets users defer without making the queue feel infinite. Server-side snooze can come later if useful.

### 5.2 Conflict (manual_review)

```
┌────────────────────────────────────────────────────────────────────┐
│  Conflict   #d7710f   scope: notes/   · 30m ago                     │
├────────────────────────────────────────────────────────────────────┤
│  3 files conflict between your edits and Sync's update              │
│                                                                     │
│  notes/X.md                                                         │
│   ┌─ Base (common ancestor) ─┐                                       │
│   │  ...                      │                                      │
│   ├─ Yours ──────────────────┤   ┌─ Theirs (sync) ──┐                 │
│   │  ...                      │   │  ...              │                 │
│                                                                     │
│   Per-file resolution:                                              │
│   ◯ Keep yours    ◯ Keep theirs    ◯ Manual merge ▾                  │
│                                                                     │
│  notes/Y.md  …                                                      │
│  notes/Z.md  …                                                      │
│                                                                     │
│  ┌──────────────────────┐  ┌──────────────────────┐                 │
│  │  Apply resolutions   │  │  Save draft & exit   │                 │
│  └──────────────────────┘  └──────────────────────┘                 │
└────────────────────────────────────────────────────────────────────┘
```

Actions:
- **Apply resolutions**: builds `resolution_files: dict[path, bytes]` and POSTs. Item drains, history row appears.
- **Save draft & exit**: client-only — stash the per-file choices in localStorage so the user can leave without losing decisions. (Backend snapshot endpoint can come in a follow-up.)
- Per-file "Manual merge ▾": opens an inline editor seeded with conflict markers; user resolves directly.

### 5.3 Resolved item still on screen?

When a user resolves something, the item must visibly leave the Needs Action group **and** the new commit must appear in History. We do this with a 400 ms slide-up animation on the Needs Action row, then we refresh History (cheap — already paginated) so the new commit is at the top with a brief highlight. No toast — the animation IS the feedback.

---

## 6. Decisions — LOCKED 2026-05-24

| # | Decision | Locked answer |
|---|---|---|
| D1 | Grouping style | **Grouped by kind, collapsible headers, counts in header.** Per the §3 sketch. |
| D2 | Empty state | **One-liner "No pending actions"** under the section heading. Block always renders so the section heading is a stable landmark, but stays visually quiet when empty. |
| D3 | v1 item types | **`Pending review` + `Conflict` only.** Both come from `mut_conflicts`; split by `policy` and `resolver_kind`. Failed-sync / risky-delete / agent-staged-session are explicit follow-ups, not stubs. |
| D4 | Snooze | **Client-only 24h localStorage.** Server-side snooze deferred until usage signals demand it. Keys: `puppyone:needs-action:snooze:{project_id}:{kind}:{id}` → expiry timestamp. |
| D5 | Plugin shape | **First-class registry.** `NeedsActionItem` is a discriminated union keyed by `kind`. A registry exports `{ kind, label, icon, fetchItems(projectId), renderRow(item, ctx), renderDetail(item, ctx) }` per kind. v1 registers exactly two; future plugins push more entries. The Section + Group components are kind-agnostic — they only know how to iterate the registry. |

---

## 7. Implementation sketch (only after §6 locks)

**Frontend, new files:**
- `frontend/app/(main)/projects/[projectId]/history/components/NeedsActionSection.tsx` — the section above filters.
- `frontend/app/(main)/projects/[projectId]/history/components/NeedsActionGroup.tsx` — one collapsible group (kind + count + rows).
- `frontend/app/(main)/projects/[projectId]/history/components/items/PendingReviewItem.tsx` — pending-review row + detail.
- `frontend/app/(main)/projects/[projectId]/history/components/items/ConflictItem.tsx` — conflict row + detail.
- `frontend/lib/needsActionRegistry.ts` — exports `{ kind, label, fetchItems, renderRow, renderDetail }` records; v1 registers two; future plugins push more.

**Frontend, modified:**
- `frontend/app/(main)/projects/[projectId]/history/page.tsx` — mount `<NeedsActionSection>` above filters in the sidebar; route the right pane between commit detail and item detail based on selection.
- `frontend/lib/conflictApi.ts` — already has the wire calls; add a thin "snooze" client helper backed by localStorage.

**Backend, modified:**
- `backend/src/version_engine/entrypoints/http/conflict.py` — confirm response includes `policy` + `resolver_kind` (it does); add a single-call combined endpoint `GET /api/v1/content/{pid}/needs-action` that returns the union of categories so the frontend doesn't fan out per kind. Optional optimization — can ship v1 without it (each kind fetches its own list).
- Future PR (PUP-5-followup): expose failed-sync queue; expose audit_detail in history rows; add a draft/staged-session primitive.

**Tests:**
- New Playwright test: load fixture project with one pending review + one conflict, assert both groups render, accept-pending-review action drains the row + adds a history commit.
- Backend pytest for the new combined endpoint if we ship it in v1.

---

## 8. Out of scope (explicitly)

- Cross-project Needs Action dashboard (this is per-project; org-level rollup is a separate feature).
- Notification routing (email/Slack on new pending review) — separate workstream.
- Resolution analytics ("you resolved 12 conflicts this week") — separate workstream.
- Modifying the History timeline's existing behaviour — should remain a no-op for users who only use the page as audit.
