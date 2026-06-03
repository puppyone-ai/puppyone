# Context Entry Points

This document defines the four product concepts PuppyOne uses when context
enters, changes, or is exposed from a workspace:

- Upload
- Import
- Connect
- Access

These words should not be used interchangeably. They describe different user
intents, different backend models, and different execution guarantees.

## Summary

| Concept | User intent | Durable relationship? | Typical backend owner |
| --- | --- | --- | --- |
| Upload | Add local files or folders into a workspace | No | Upload / ETL pipeline |
| Import | Copy a snapshot from an external source | No | ImportJob |
| Connect | Bind an external source so it can be synced later | Yes | Connection |
| Access | Expose a workspace scope to a person, tool, or runtime | Yes | repo_scopes + access surfaces |

All four concepts may write to the Version Engine, but none of them owns
version semantics. Every write must enter through a Version Engine write
intent or ProductOperationAdapter command.

## Upload

Upload means the user is adding local bytes from their machine into the
workspace.

Examples:

- Upload files from the browser.
- Upload a local folder.
- Drop files into the Data view.
- Upload a PDF and optionally run OCR / ETL.

Upload is not a connector. It is not a durable relationship with the user's
machine. It is a one-shot transfer from a local source.

Upload is allowed to have its own pipeline because it has concerns that other
flows do not:

- Browser file and folder selection.
- Direct-to-S3 or multipart transfer.
- Upload policy, ignored folders, blocked files, duplicate paths, and limits.
- OCR, structured extraction, and post-processing.
- Finalization from staged object storage into the Version Engine.

Product placement:

- Primary entry: Add content -> Upload files/folder.
- Empty workspace entry: Upload folder can initialize the workspace.
- Existing workspace entry: Upload into the current folder or selected target.

Backend shape:

```text
UploadJob / UploadItem / ETLTask
  -> staged object storage
  -> optional OCR / ETL
  -> Version Engine write
```

## Import

Import means the user is copying a snapshot from an external source into the
workspace without creating an ongoing relationship.

Examples:

- Import a GitHub repository URL as a one-time snapshot.
- Import a website or URL crawl.
- Import a Notion page once.
- Import starter/template content.

Import is not the same thing as initialization. Initialization is just the
first successful content write in an empty workspace. An empty workspace can be
initialized by upload, import, connect-and-sync, or start blank.

Import should use provider capabilities when useful, but the provider must not
own task status. The import job owns lifecycle.

Backend shape:

```text
ImportJob
  -> resolve provider capability
  -> provider.fetch(...)
  -> Version Engine write
  -> terminal status: completed | failed | cancelled
```

Import has no pause/resume sync controls, no schedule, no webhook, and no
long-lived external binding. It can expose progress and result history as task
history, but it should not appear as an Access surface.

Product placement:

- Primary entry: Add content -> Import from ...
- Empty workspace entry: Import from GitHub / website / template.
- Activity entry: show active and recent import jobs.

## Connect

Connect means the user is creating a durable relationship between the workspace
and an external system. Synchronize is the action that happens through that
relationship; Connect is the product-level setup verb.

Examples:

- Connect a GitHub repository branch.
- Connect Google Drive and sync selected files.
- Connect Gmail and refresh messages manually or on a schedule.
- Connect a database and save query results.
- Connect a local folder through the desktop / filesystem sync path.

A connection is not itself a run. It is configuration plus state:

- Provider and external resource identity.
- OAuth or credential reference.
- Direction: inbound, outbound, or bidirectional.
- Trigger: manual, scheduled, webhook, or realtime.
- Cursor, watermark, remote hash, or last synced commit.
- Lifecycle status: active, paused, error.

Each execution is a SyncRun.

Backend shape:

```text
Connection
  -> SyncRun(triggered_by=manual | scheduled | webhook | realtime)
  -> provider.fetch(...) or provider.push(...)
  -> Version Engine write or external write
  -> update watermark / cursor / run history
```

Connect may run an initial sync after creation, but that initial sync is still
a SyncRun. It should not be represented as an ImportJob unless the user chose a
one-shot import instead of a durable connection.

Product placement:

- Primary entry: Connect source.
- Per-connection actions: Sync now, Pause, Resume, Disconnect, View runs.
- Status surfaces: Needs Action, failed runs, last synced time.

## Access

Access means the workspace exposes a scoped way for a user, tool, agent, or
runtime to read or write context. Access is about who or what can operate on
the workspace. It is not about fetching external source data.

Examples:

- Git remote URL for a scope.
- PuppyOne CLI / AP-FS access key.
- In-app Agent bound to a scope.
- MCP endpoint.
- Sandbox endpoint.

Access surfaces are backed by `repo_scopes` and `access_surfaces`. Legacy
built-in connector rows are migration input and compatibility history; runtime
Access should be described as an entry point into workspace context, not an
import mechanism.

Backend shape:

```text
repo_scopes
  -> access key / identity / permission boundary
  -> Git Remote, CLI, Agent, MCP, Sandbox, or other surface
  -> Version Engine read/write path
```

Access can be paused, scoped, permissioned, and audited. It should not create
ImportJob rows. It should not be shown for one-shot imports.

Product placement:

- Primary entry: Access workspace.
- Per-scope settings: Git remote, CLI, Agent, MCP, Sandbox.
- Access health and permissions live near scope/project settings.

## Provider Capabilities

Providers are implementation capabilities, not product flows.

A provider may support one or more capabilities:

- list resources
- fetch content
- push content
- verify credentials
- create webhook
- parse source URLs

The provider layer must not decide whether a user is uploading, importing,
connecting, or accessing. The orchestrator decides that.

Good boundary:

```text
GithubProvider.fetch_repo_archive(...)
GithubProvider.fetch_branch_tree(...)
GithubProvider.push_branch_commit(...)
```

Bad boundary:

```text
GithubProvider.create_import_job(...)
GithubProvider.mark_sync_failed(...)
GithubProvider.publish_version_commit(...)
```

## GitHub Example

GitHub has multiple product meanings. They must stay separate.

| User action | Product concept | Backend model |
| --- | --- | --- |
| Paste `https://github.com/org/repo` and copy files once | Import | ImportJob(provider=github) |
| Bind this project to `org/repo` branch `main` | Connect | GitHub connection / integration + SyncRuns |
| Push and pull through PuppyOne Git remote | Access | repo_scope Git access surface |
| Upload a local cloned repo folder | Upload | Upload pipeline; `.git/` is skipped |

There should not be a third product path where `connectors[github]` creates an
`import_once` sync binding. That combines Import and Connect and makes the UI,
run history, and deployment model ambiguous.

## Target Execution Model

Long-running work should run outside the HTTP request path.

Worker split:

```text
api
upload_worker   -> upload finalize, OCR, ETL
import_worker   -> ImportJob execution
sync_worker     -> SyncRun execution
scheduler       -> schedules work, enqueues SyncRuns, does not fetch content
```

ARQ can be the shared execution technology, but the queues should be separate:

```text
uploads
imports
syncs
```

This prevents a slow OCR backlog from blocking GitHub imports, and prevents a
large import from starving scheduled syncs.

## Activity And History

The frontend may show upload, import, and sync activity in one Activity UI, but
the underlying models should remain separate.

Unified activity item:

```text
ActivityItem
  id
  kind: upload | import | sync_run
  label
  status
  progress
  message
  created_at
  completed_at
  result_path
```

The activity UI is an aggregation layer. It must not force Upload, Import, and
SyncRun into one database table or one lifecycle model.

## Naming Rules

Use these names consistently:

- Use "Upload" only for local files/folders.
- Use "Import" only for one-shot external snapshots.
- Use "Connect" for durable external relationships.
- Use "Sync" for executions or actions on a connection.
- Use "Access" for workspace entry points and permissioned surfaces.
- Avoid calling everything "Connect".
- Avoid showing one-shot imports inside Access.
- Avoid creating `import_once` sync bindings for new flows.

## Migration Direction

Current implementation should route runtime code through the target tables. The
migration rule is:

1. Backfill existing legacy rows into target tables.
2. Stop creating new `import_once` sync bindings.
3. Route one-shot external sources through ImportJob.
4. Route durable external relationships through Connection.
5. Route GitHub branch binding through the GitHub integration / connection
   model, not generic `connectors[github]`.
6. Route webhook-triggered GitHub sync through sync_worker as a SyncRun, not
   an in-process background task.
7. Hide one-shot import records from Access surfaces.
8. Keep all writes going through the Version Engine.

The target product taxonomy is:

```text
Add content
  Upload files/folder
  Import from external source

Connect source
  Create durable external relationship
  Sync now / scheduled sync / webhook sync

Access workspace
  Git remote / CLI / Agent / MCP / Sandbox
```
