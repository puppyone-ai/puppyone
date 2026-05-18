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
  -> receive-pack stores incoming pack in quarantine
  -> scope/exclude validation rejects out-of-bound paths
  -> changed paths are computed from old/new commits
  -> reachable objects promote after validation
  -> VersionSubmissionIntent enters GitNativeTransactionEngine
  -> SQL CAS publishes scope head/history/audit/outbox
```

## Product/API Save

Product saves do not run the Git transport. They submit typed tree splices to
the same transaction engine and avoid full-repo materialization.

