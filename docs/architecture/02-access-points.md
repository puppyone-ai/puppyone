# Access Points

An Access Point is the external repo-like entry for a scoped part of a
PuppyOne project. Each access key resolves to:

- `project_id`
- `scope_path`
- `exclude` rules
- `mode` (`r` or `rw`)
- optional identity binding
- channel pause state

## External Surfaces

```text
Git Remote:
  https://<host>/git/ap/<access_key>.git

Puppyone CLI filesystem API:
  /api/v1/ap-fs/*
  X-Access-Key: <access_key>
```

Both surfaces resolve through the same Access Point auth path and then submit
to the Version Engine.

## Internal Model

```text
repo_scopes row
  -> RepoFacade(project_id, scope_path, excludes, mode)
  -> Git transport or AP-FS router
  -> Version Engine transaction
  -> shared project object store + scope-state refs
```

Access Points behave externally like scoped repos, but internally they share one
project object store. This keeps clone/push semantics familiar while avoiding a
physical repo explosion.
