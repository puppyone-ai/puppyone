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
  -> upload-pack advertises only reachable scoped objects
```

## Push

```text
git push
  -> request body is spooled to disk so large/chunked HTTP pushes do not sit in Python heap
  -> stock git receive-pack --stateless-rpc parses protocol and ingests the pack
  -> official Git stores accepted objects/refs in an isolated quarantine bare repo
  -> scope/exclude validation rejects out-of-bound paths
  -> changed paths are computed from old/new commits
  -> excluded-scope pushes merge only visible changed paths into the canonical tree
  -> reachable objects promote after validation
  -> VersionSubmissionIntent enters VersionWriteEngine
  -> SQL CAS publishes scope head/history/audit/outbox
```

The Git transport cache and quarantine repo are never authoritative. They are
protocol workspaces only. Puppyone's canonical source of truth remains the
Version Engine object store plus database refs/history/audit. Product-level
rejections that happen after official Git accepts a temporary ref are returned
as normal receive-pack `ng <ref> puppyone-rejected: ...` results.
For Access Points with excludes, the advertised Git ref is a filtered view;
Puppyone preserves hidden canonical files by applying only the visible changed
paths from the pushed tree.

## Product/API Save

Product saves do not run the Git transport. They submit typed tree splices to
the same transaction engine and avoid full-repo materialization.
