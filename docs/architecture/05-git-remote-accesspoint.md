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
is a durable L6 per-view bare repo under `GIT_VIEW_CACHE_DIR`
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
warming belongs to L6 background work after Access Point creation or after a
version commit, not to the first user's clone request.

## Product/API Save

Product saves do not run the Git transport. They submit typed tree splices to
the same transaction engine and avoid full-repo materialization.
