# Git Remote Access Point Flow

## Create

```text
Web / API creates repo scope
  -> repo_scopes row stores scope_path, excludes, mode, access_key hash
  -> user receives Git Remote URL and Puppyone CLI profile instructions
```

## Clone

```text
git clone https://<host>/git/ap/<access_key>.git
  -> Git info/refs resolves access key
  -> RepoFacade builds scoped/excluded view
  -> GitViewHead resolver returns the Git-visible HEAD and health state
  -> Git View Cache Manager ensures the durable per-view bare repo is warm
  -> upload-pack serves only reachable scoped objects from that cache
```

## Push

```text
git push
  -> request body is spooled to disk so large/chunked HTTP pushes do not sit in Python heap
  -> receive-pack advertisement uses the same GitViewHead as clone/fetch
  -> Git View Cache Manager opens the durable per-view bare repo as the delta-base cache
  -> stock git receive-pack --stateless-rpc parses protocol and ingests the pack
  -> official Git stores accepted objects/refs in an isolated quarantine bare repo
  -> client old_id is checked against the Git-visible HEAD
  -> write-engine CAS uses the canonical L5 scope head
  -> scope/exclude validation rejects out-of-bound paths
  -> changed paths are computed from old/new commits
  -> excluded-scope pushes merge only visible changed paths into the canonical tree
  -> reachable objects promote after validation
  -> VersionSubmissionIntent enters VersionWriteEngine
  -> SQL CAS publishes scope head/history/audit/outbox
```

The Git view cache and quarantine repo are never authoritative. The view cache
is a durable L5 Follow-up per-view bare repo under `GIT_VIEW_CACHE_DIR`
(`~/.puppyone/git-view-cache` by default); the quarantine repo remains per-push
and temporary. Puppyone's canonical source of truth remains the Version Engine
object store plus database refs/history/audit. Product-level rejections that
happen after official Git accepts a temporary ref are returned as normal
receive-pack `ng <ref> puppyone-rejected: ...` results.
For Access Points with excludes, the advertised Git ref is a filtered view;
Puppyone preserves hidden canonical files by applying only the visible changed
paths from the pushed tree.

Cache identity is per Git view, not per access-key secret:

```text
project_id + scope_path + scope_excludes + projection_version
  + history_mode + object_store_namespace
```

Multiple Access Points that resolve to the same view reuse the same cache.
If the cache is missing or unhealthy, it can be rebuilt from committed
Version Engine facts.

Git health is resolved before a ref is exposed:

```text
empty               -> no ref is advertised
healthy             -> canonical head is Git-compatible
history_degraded    -> current content is healthy, but legacy ancestry is cut
current_corrupt     -> current content cannot be projected; Git is rejected
```

`history_degraded` is still Git-usable. The client sees a truncated/projected
HEAD, and subsequent pushes are validated against that Git-visible old id while
publishing through the canonical L5 scope head. `current_corrupt` is not
Git-usable; users must restore or repair the current tree before clone/fetch/push
can resume.

The product-facing status endpoint is:

```text
GET /git/ap/<access_key>.git/health
```

It returns the same `GitViewHead` resolution used by clone/fetch/push, including
`health`, `git_head`, `canonical_head`, `history_cut`, Git usability booleans,
and recommended recovery actions. This route is a read/diagnostic path; cache
warming belongs to L5 Follow-up background work after Access Point creation or
after a version commit, not to the first user's clone request.

## PuppyOne Cloud Git Remote Contract

PuppyOne Cloud exposes a Git remote as a transport for a scoped workspace, not
as a GitHub-style collaboration surface. The default product model is one
visible cloud source of truth:

```text
PuppyOne Cloud remote = one workspace scope
refs/heads/main       = the only product-visible truth branch
```

Command examples below assume the local remote is named `puppyone`. A plain
`git clone` may name the same remote `origin`; the contract is the same.

| Capability | Product action | Support | Git behavior | Product rule |
|---|---|---:|---|---|
| Clone | Clone from Cloud | Yes | `git clone <puppyone-url>` | Create a local checkout of the cloud workspace/scope. |
| Fetch | Refresh Cloud Status | Yes | `git fetch puppyone main` | Update local knowledge of cloud state without changing the working tree. |
| Fast-forward download | Download | Yes | `git pull --ff-only --autostash puppyone main` | Use when local `main` has no committed changes beyond cloud; preserve staged/tracked edits automatically. |
| Rebase download | Download | Yes | `git pull --rebase --autostash puppyone main` | Use when local committed changes exist and cloud also has newer commits; preserve staged/tracked edits automatically. |
| Upload | Upload | Yes | `git push puppyone HEAD:main` | Allowed only when the push is fast-forward against cloud `main`. |
| Force push | Overwrite Cloud | No | reject non-fast-forward / `--force` | Never allow a client to overwrite the cloud source of truth. |
| Merge commit push | Upload merge commit | No | reject commits with multiple parents | Keep workspace history linear and explainable. |
| Delete remote ref | Delete cloud ref/history | No | reject ref deletion | Cloud history is append-only; rollback is a product operation. |
| Git LFS | Git LFS large files | No | reject LFS pointer blobs | Large binaries must use PuppyOne upload/object APIs. |
| Branch push | Raw Git branch storage | Yes, transport-level | stored as named refs; does not advance `main` | Advanced clients may store branch refs, but PuppyOne Cloud does not provide a merge-to-main shortcut. |
| Tag push | Raw Git tag storage | Yes, transport-level | stored as named refs; does not advance `main` | Tags stay transport metadata and are not part of the default knowledge-collaboration UX. |
| Conflict handling | Resolve conflict | Basic local support | rebase conflict in the client | Same-source Git concurrency is resolved by client rebase, not server merge. |
| Health | Cloud Health | Yes | `GET /git/.../health` | Report whether clone/fetch/push are safe for this Git view. |
| Rebuild cache | Repair Git View | Hidden/admin | `POST /git/.../rebuild-cache` | Repair transport projection from canonical Version Engine facts. |

The desktop product should map this contract to two primary cloud actions:

```text
Download:
  fetch puppyone
  if local has no committed changes:
    pull --ff-only --autostash puppyone main
  else:
    pull --rebase --autostash puppyone main

Upload:
  push puppyone HEAD:main
  reject/disable if cloud has newer commits
```

The client must not present `git push --force`, server-side merge proposals,
branch merge-to-main shortcuts, or default branch switching as PuppyOne Cloud
collaboration primitives. Raw branch/tag refs may exist for Git transport
compatibility, but cloud `main` remains the product-visible source of truth.

Same-source Git concurrency stays in the Git layer: if Alice and Bob both push
to the same scope from an older base, the second push receives
`non-fast-forward`, rebases onto cloud `main`, resolves any local textual
conflict, and pushes a new fast-forward commit. Hosted conflict review is for
cross-entrypoint product conflicts, such as Git vs product/API writes, not for
normal same-scope Git races.

## Product/API Save

Product saves do not run the Git transport. They submit typed tree splices to
the same transaction engine and avoid full-repo materialization.
