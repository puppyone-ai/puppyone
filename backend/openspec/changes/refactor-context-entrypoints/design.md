# Design: Context Entry Points

## Context

The existing implementation has three separate historical layers:

- Legacy `connections`, later renamed to `access_points`, then split into
  `repo_scopes` and `connectors`.
- `connectors` used for built-in access surfaces and third-party data sources.
- `import_jobs` introduced for one-shot GitHub imports.

This created a product mismatch: GitHub can mean a one-shot repository import,
a durable branch connection, or a Git remote access surface. These are separate
user intents and must not share one lifecycle model.

## Goals

- Make Upload, Import, Connect, and Access distinct product concepts.
- Give each concept a backend model with lifecycle fields appropriate to that
  concept.
- Keep provider code as capability code only.
- Keep task status owned by orchestration tables, not providers.
- Preserve legacy data and avoid destructive migrations.
- Route long-running work out of the HTTP request path.

## Non-Goals

- Do not remove `uploads`, `connectors`, `connector_runs`, or
  `github_integrations` in this change.
- Do not rewrite the Version Engine.
- Do not make frontend activity a write model.
- Do not make providers responsible for import or sync persistence.

## Target Model

Upload:

```text
upload_jobs -> upload_items -> staged storage / ETL -> Version Engine write
```

Import:

```text
import_jobs -> provider capability -> Version Engine write
```

Connect:

```text
connections -> sync_runs -> provider capability -> Version Engine or external write
```

Access:

```text
repo_scopes -> access_surfaces -> scoped read/write path
```

## Worker Queues

ARQ can remain the execution technology, but queue ownership must be separate:

```text
uploads
imports
syncs
```

The API creates rows and enqueues work. Workers own execution and status
transitions. The scheduler only creates or enqueues sync runs; it does not fetch
provider content in-process.

## GitHub Boundary

GitHub must be represented according to user intent:

- Import GitHub repo once: `import_jobs(provider='github')`.
- Connect GitHub branch: `connections(provider='github')` plus `sync_runs`.
- Use PuppyOne Git remote: `access_surfaces(kind='git_remote')`.
- Upload a local cloned repository folder: `upload_jobs`; `.git/` is skipped.

New code must not create `connectors[github]` rows with `import_once` triggers
for one-shot imports.

## Migration Strategy

The target migration is additive. Runtime migration should proceed in this
order:

1. Create target tables and docs.
2. Move upload creation and upload history to `upload_jobs` and `upload_items`.
3. Move one-shot external imports exclusively to `import_jobs`.
4. Move durable third-party source bindings to `connections`.
5. Move sync execution history to `sync_runs`.
6. Move built-in access surfaces out of datasource connector language and into
   `access_surfaces`.
7. Keep compatibility reads for legacy tables until product surfaces no longer
   need them.

## Risks

- Renaming product concepts without updating UI affordances will keep user
  confusion alive.
- Sharing one ARQ queue across uploads, imports, and syncs can still make
  imports appear stuck when another workload blocks the worker.
- Leaving GitHub webhook sync as an in-process background task can lose work
  when the API process restarts.
