# PUP: Multi-Branch Git Support (GAP-3 Design Sketch)

**Status:** Design sketch — not yet scheduled  
**Blocker for:** Feature-branch workflows, PR-like review (PUP-5 staged session), tag releases  
**Gap reference:** GAP-3 in `09-gap-analysis-2026-05-31.md`

---

## Problem

PuppyOne Git remotes today accept pushes only to `refs/heads/main`. Any attempt
to push a feature branch or tag is hard-rejected with a clear error. This is
the correct behaviour until branch storage is explicitly designed — accepting
a push to `refs/heads/feature-x` while silently publishing it to `main` would
be worse.

The consequence is that PuppyOne cannot participate in the standard Git
feature-branch → PR → merge workflow that nearly all teams use.

---

## What Multi-Branch Requires

### 1. Per-scope ref store (DB)

A new table (or column set) is needed to persist the ref state for each scope:

```sql
CREATE TABLE version_refs (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    scope_id   uuid REFERENCES repo_scopes(id) ON DELETE CASCADE,
    ref_name   text NOT NULL,          -- e.g. refs/heads/feature-x
    commit_id  text NOT NULL,          -- 40-hex SHA-1
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    UNIQUE (project_id, scope_id, ref_name)
);
```

The existing `mut_commits` / `version_commits` table records commits. A ref is
just a named pointer to a commit — small and cheap to persist.

### 2. Push routing: write to the named ref, not to scope head

`receive_pack.py` currently calls `submit_version(…)` which unconditionally
publishes the commit to the scope's head (updating `mut_scope_state`).

For non-main branches, the push must:
1. **Validate** the push against the current tip of that branch (not main).
2. **Store the new commit** in `version_commits` (same as today).
3. **Update `version_refs`** to point at the new commit.
4. **NOT** update `mut_scope_state` / `mut_root_hash` — branch commits are
   pending, not landed.

### 3. Fetch / clone routing

`upload_pack.py` currently resolves `HEAD` + `refs/heads/main` from the
scope's current root state. With multi-branch it must:
1. Query `version_refs` for the requested scope to get all branch tips.
2. Advertise them in the `info/refs` response alongside `HEAD`.
3. Pack-serve objects reachable from any advertised tip.

### 4. Branch merge (landing to main)

A branch is "landed" by a merge operation:
- Fast-forward: update scope head to the branch tip (existing path).
- Three-way merge: call the version engine's merge primitive, create a merge
  commit, update scope head.

This is the step that actually updates `mut_scope_state` / `mut_root_hash`
and triggers the L5 follow-up projection hooks.

The PUP-5 "PR-like review unit" (GAP-13) wraps this: a branch push creates
a "pending review" NeedsAction item; approval triggers the merge.

### 5. Tag storage

Tags are simpler: a tag ref points at a commit (lightweight) or a tag object
(annotated). Store in `version_refs` with `ref_name = refs/tags/v1.2.3`.
Tags are immutable after creation (no force-push).

---

## Minimal Implementation Path (phased)

### Phase 1 — Branch push + advertise (no merge UI)
- Add `version_refs` table (migration).
- `_ref_writability()`: allow `refs/heads/*` and `refs/tags/*`.
- `submit_version()`: detect non-main refs → write to `version_refs` instead
  of `mut_scope_state`.
- `info/refs`: advertise `version_refs` rows for the scope.
- No UI — teams can push branches; merge is `git merge` locally then push main.

### Phase 2 — Merge via API
- `POST /api/v1/content/{id}/branches/{branch}/merge` (fast-forward or 3-way).
- Conflict reporting (reuses existing conflict resolution primitives).

### Phase 3 — PR-like review (PUP-5 staged session)
- Push creates a NeedsAction item.
- Approval triggers the Phase 2 merge endpoint.
- Rejection closes the branch (or the author resolves conflicts and re-pushes).

---

## Estimated Effort

| Phase | Work |
|---|---|
| Phase 1 | ~1 week (DB migration + receive/upload-pack routing changes) |
| Phase 2 | ~1 week (merge endpoint + conflict UI) |
| Phase 3 | ~2 weeks (NeedsAction integration + review UI) |

**Total: ~4 weeks engineering + separate QA/migration cycle.**

---

## Current state (2026-05-31)

- `_ref_writability()` rejects non-main refs with a clear, actionable error
  message directing users to merge locally before pushing.
- The reject message for `refs/heads/<branch>` was improved to explain *why*
  (multi-branch not yet implemented) and where to track progress.
- The reject message for `refs/tags/*` was corrected (previously said
  "tag through the project API" which does not exist).

No code changes beyond error messages are made until this design is approved
and Phase 1 is scheduled as a tracked work item.
