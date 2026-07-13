# Git Remote Locator, Credential, And Access Point Contract

Status: **current canonical architecture; additive migration in progress**

The runtime implements the two canonical locator families below and still
accepts the legacy secret-bearing `/git/ap/<access_key>.git` route as a bounded
compatibility adapter. The reviewed implementation record is OpenSpec change
[`refactor-canonical-git-remote-contract`](../../backend/openspec/changes/refactor-canonical-git-remote-contract/design.md).
Deployment gates, database checks, telemetry, and rollback procedure live in
the [Canonical Git Remote Rollout Runbook](../ops/canonical-git-remote-rollout.md).

This document is the normative owner of PuppyOne's Git remote contract:

- canonical root and scoped URL grammar;
- Git HTTP credential transport and storage;
- exact Project/Scope/Access Surface resolution;
- the boundary between Git transport and the Version Engine;
- legacy remote migration and retirement.

Human Project roles and local Workspace Binding semantics belong to
[Project Authorization and Workspace Binding](12-project-authorization-and-workspace-binding.md).
Canonical-root publish, scope projection, conflict, and repair mechanics belong
to the [Version Engine](01-version-engine.md).

## Four facts that must remain separate

```text
Git Remote Locator
  -> declares Project and root/scoped target
  -> stable and non-secret

Git Runtime Credential
  -> authenticates one machine principal
  -> opaque, revocable, hash-only at rest

RuntimeGrant
  -> effective Project + Scope + path + excludes + r/rw
  -> the only Git authority passed into Version Engine admission

WorkspaceBinding
  -> says which Cloud Project/Scope one local workspace instance represents
  -> stable identity only; grants nothing
```

A Project ID or Scope ID is a locator, not a capability.  A credential is a
capability, not a locator.  A Git credential cannot grant human access to
Project settings, members, Team, Billing, sharing, or credential management.

## Canonical Git remote locators

### Project root

```text
https://<git-origin>/git/{project_id}.git
```

This locator always means the canonical root Scope.  A non-root credential is
rejected even when it belongs to the same Project.

### Non-root Scope

```text
https://<git-origin>/git/{project_id}/scopes/{scope_id}.git
```

This locator always means the exact non-root Scope.  The Project ID is repeated
intentionally so a client can identify the owning Project without resolving a
secret and the server can verify the Project/Scope relation before opening
repository state.

Scope names and filesystem paths are not URL identity.  They may be renamed,
require escaping, and can disclose content structure.  The immutable Scope ID
is the locator; the current path and excludes are resolved server-side on every
authenticated request.

Neither URL implies a physical repository per Scope.  Both select a RepoFacade
over the Project-shared object store and canonical Project root.

### Smart-HTTP shape

Stock Git appends the ordinary smart-HTTP endpoints to either locator:

```text
GET  <remote>/info/refs?service=git-upload-pack
GET  <remote>/info/refs?service=git-receive-pack
POST <remote>/git-upload-pack
POST <remote>/git-receive-pack
```

PuppyOne additionally exposes:

```text
GET  <remote>/health
POST <remote>/rebuild-cache
```

These locator-relative health and rebuild routes are part of the Git machine
data plane. They accept the same exact `git_http_token`/RuntimeGrant as
clone/fetch/push; a browser JWT is never accepted as a substitute. Human Web
surfaces use the separate root-only Project control-plane adapters:

```text
GET  /api/v1/projects/{project_id}/git-view/health          Project Read
POST /api/v1/projects/{project_id}/git-view/rebuild-cache   Project Manage
```

Those adapters re-authorize the current `ProjectGrant`, resolve the canonical
root Scope, and call the same derived `GitViewHead`/cache rebuild operations.
They do not forward the JWT into `/git`, mint a RuntimeGrant, or create a
second Version Engine path. The health response includes an explicit
`can_rebuild` capability so clients do not infer administration rights from a
role label or from content-write authority.

Target identity is accepted only from the canonical path.  Query parameters,
request bodies, usernames, and actor headers cannot override Project or Scope.
Project and Scope IDs use their literal canonical ASCII form; percent-encoded
route identity is rejected instead of being decoded into a second spelling of
the same locator.

## Git runtime credentials

Canonical URLs contain no replayable secret.  Stock Git authenticates with
HTTP Basic:

```text
username: x-puppyone-token
password: <one-time Git runtime credential>
```

Programmatic clients that can set headers directly may use Bearer transport.
Missing or invalid credentials receive a challenge without target disclosure:

```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Basic realm="PuppyOne Git"
```

The raw credential is returned only on create or rotation.  The server stores:

```text
HMAC hash
prefix and last four characters
credential type
grant mode
credential lifecycle class (`shared`, `session`, or `binding`)
status and lifecycle timestamps
Access Surface relation
optional Workspace Binding relation
```

It does not store replayable plaintext.

Project, Scope, Repo Identity, and dashboard discovery responses never return
a Git or CLI credential. They may return a non-replayable hint and an explicit
`has_credential` fact, but setup commands are constructed only from a dedicated
one-time issuance response. A field named `access_key` in a list response must
remain null; a masked value is presentation metadata, not a usable secret.

Interactive first-party clients use an OS-backed Git credential helper and set
path-aware matching for the PuppyOne host because one host can serve multiple
Project/Scope credentials:

```text
credential.useHttpPath=true
```

Clients must not use `credential.helper store`, put credentials in URL
userinfo, persist a long-lived Authorization extra-header, or write secrets to
the PuppyOne manifest.  Sandbox and worker clients use short-lived credentials
through an ephemeral helper or process-scoped environment.

## One credential model for Project and Scope Git

PuppyOne does not implement separate Project-key and Scope-key policy engines.
Every Git credential resolves through the same relationship:

```text
access_surface_credentials
  -> access_surfaces(kind='git_remote', status='active')
  -> repo_scopes
  -> projects
```

Project-level Git is the same model pointed at `repo_scopes.is_root=true`.
Scoped Git points at one non-root Scope.  `project_id` may be duplicated on
credential/surface rows for database integrity and indexing, but the exact
Scope relation remains mandatory.

Each credential has a mode ceiling:

```text
r  -> clone, fetch, read, history and health
rw -> r plus permitted push/write operations
```

The Scope's mode is a maximum.  It is not the individual credential grant.  A
read-write Scope can therefore have both read-only and read-write credentials.

Shared credentials use two independent manual rotation slots, one `r` and one
`rw`. Rotating the `r` slot revokes only the previous shared `r` credential;
it does not revoke the shared `rw` credential, binding credentials, or
short-lived Sandbox/session credentials. Session credentials are independently
expiring and may coexist. Rotation is serialized on the Access Surface so two
concurrent rotations cannot leave two winners for one manual slot.

`access_surface_credentials.credential_lifecycle` is the authoritative
revocation-domain fact. Rotation code must filter `shared`; it must never infer
"shared" merely from a null binding or from `grant_mode`. A `session` row must
have an expiry, while a `binding` row must have a Workspace Binding relation.
The database trigger derives this field only for expand-phase callers that do
not yet send it explicitly.

Binding credentials are independently issued for one local workspace and are
rechecked against the binding and current human capability.  Shared service
credentials are Project-Admin managed and should be expiring wherever the
runtime supports rotation.

The existing Scope `cli_...` bearer token is a separate protocol credential.
It is issued once through the Scope credential-management endpoint and never
reused as a canonical Git password. Rotating it may support the bounded legacy
route during migration, but cannot mutate any canonical Git rotation domain.

## Exact target resolution

Authentication and target selection are one fail-closed L2 operation.

### 1. Parse the declared target

```text
root URL   -> GitRouteTarget(project_id, root)
scope URL  -> GitRouteTarget(project_id, scoped, scope_id)
```

IDs receive strict syntax and length validation before repository access.

### 2. Extract and hash the credential

The Git adapter extracts the Basic password or Bearer value and HMAC-hashes it.
No route component, username, Project ID, Scope ID, or Git actor string is
accepted as proof of permission.

### 3. Resolve one bounded fact set

Production resolution loads the following as one repository join or
transactional RPC rather than independently trusted lookups:

```text
credential: status, expiry, grant_mode, binding relation
surface: project, scope, kind, status, channel policy
scope: project, path, excludes, mode, is_root
binding: project, scope, user, mode, status (when present)
current human capability (only for a binding credential)
```

### 4. Match every identity

All requests require:

```text
credential.project_id == route.project_id
surface.project_id    == route.project_id
scope.project_id      == route.project_id
surface.scope_id      == scope.id
surface.kind          == git_remote
surface.status        == active
credential.status     == active and unexpired
```

Root additionally requires:

```text
scope.is_root == true
scope.path == ''
```

Scoped additionally requires:

```text
scope.is_root == false
scope.id == route.scope_id
```

A binding credential additionally requires exact binding Project/Scope/user
facts, an active binding, and current human capability.  Unknown values,
repository errors, tenant mismatches, role downgrades, disabled surfaces,
revoked bindings, and unsupported credential types fail closed.

### 5. Calculate effective authority

Authority only narrows:

```text
effective_mode = minimum(
  scope.mode,
  credential.grant_mode,
  binding.mode                when binding-backed,
  current human capability    when binding-backed,
  surface/channel policy,
)
```

### 6. Emit RuntimeGrant

Only the immutable result enters Version Engine admission:

```text
RuntimeGrant(
  principal,
  project_id,
  scope_id,
  path,
  excludes,
  mode,
  policy,
)
```

Git routes do not carry a raw ProjectGrant into the data plane.  If a future
human-session Git flow is supported, L2 must exchange or translate that session
into a bounded RuntimeGrant first.

## Version Engine boundary

The locator/credential change ends at L2.  It does not create a second write
path.

```text
canonical locator + HTTP credential
  -> exact RuntimeGrant
  -> RepoFacade(project, scope path, excludes, mode, main ref)
  -> GitViewHead
  -> Git transport cache
  -> stock upload-pack / receive-pack
  -> isolated quarantine for push
  -> VersionSubmissionIntent
  -> scope and exclude validation
  -> canonical Project root CAS
  -> source Scope head/history/audit/outbox
```

The quarantine repository and transport cache are never authoritative.
PuppyOne's source of truth remains canonical Git objects plus committed Version
Engine refs, transactions, history, audit, and outbox facts.

For a scoped push, the accepted visible subtree is grafted into the canonical
Project root.  Hidden excluded content is preserved.  Same-source concurrent
pushes use normal Git non-fast-forward/rebase behavior; cross-entrypoint path
conflicts remain Version Engine policy.

## Git view cache identity

Cache identity is a content-view identity, not a credential or URL identity:

```text
project_id
+ scope_path
+ scope_excludes
+ projection_version
+ history_mode
+ blob_mode
+ object_store_namespace
```

Credential, binding, user, route family, and raw Scope ID do not enter the
cache key.  Multiple principals with the same effective view reuse one derived
cache.  Credential rotation never invalidates content caches.

If a Scope keeps its ID but changes path, resolution supplies the new geometry
and therefore a new view key; the old cache remains derived, non-authoritative,
and eligible for pruning.

## Clone and fetch

```text
git clone/fetch
  -> HTTP challenge and credential-helper lookup
  -> exact RuntimeGrant
  -> RepoFacade builds root or scoped/excluded view
  -> GitViewHead resolves empty/healthy/degraded/corrupt state
  -> Git view cache is verified or rebuilt from committed facts
  -> stock upload-pack serves only reachable objects for that view
```

Git health states remain:

```text
empty               -> no ref advertised
healthy             -> canonical head is Git-compatible
history_degraded    -> current content works; legacy ancestry is truncated
current_corrupt     -> current content cannot be projected; Git rejects
```

## Push

```text
git push
  -> receive-pack body spooled to disk
  -> exact RuntimeGrant and rw admission
  -> advertisement uses the same GitViewHead as clone/fetch
  -> stock git receive-pack --stateless-rpc parses protocol
  -> objects and temporary refs enter isolated quarantine
  -> old_id checked against the Git-visible Scope head
  -> scope/exclude/LFS/ref policy validates the proposed tree
  -> accepted visible paths splice into the canonical root
  -> Version Engine publishes through root and source-Scope CAS
  -> reachable objects, history, audit and outbox commit
  -> product rejection returns normal receive-pack ng status
```

No locator or credential path may publish outside the Version Engine.

Git commit attribution and Git actor headers are client-supplied labels, not
authorization identity. Every fetch/push audit record also captures the
immutable RuntimeGrant principal ID, credential kind, Access Surface ID, and
optional Workspace Binding ID. Incident response and authorization analysis
must use those server-resolved facts rather than trusting the claimed actor.

## Project readiness

Project Git/Claude readiness remains a projection of durable facts:

```text
active canonical-root git_remote surface
AND canonical root head
AND committed Version Engine transaction
    where scope_path = '' and source_channel = 'access_git'
```

The root URL can satisfy this only after an accepted root push.  The scoped URL
always resolves to a non-root Scope and never satisfies root readiness.

## Workspace discovery versus identity

A trusted canonical locator can be parsed into one deterministic
Project/Scope candidate:

```text
/git/{project_id}.git
  -> Project candidate + full/root kind

/git/{project_id}/scopes/{scope_id}.git
  -> Project candidate + exact scoped kind
```

That candidate must still pass current-user ProjectGrant checks before private
metadata is rendered.  It does not grant human access and does not become a
Workspace Binding by itself.

An already-bound workspace opens the verified Project directly without first
enumerating Organization Projects.  If local binding state is absent, the
canonical locator can drive one explicit attach/recovery flow; Desktop must not
scan every Project, Scope, or shared key.

Desktop also suppresses the Organization Project-catalog request while a Local
workspace target is being resolved. Session restoration and Project-catalog
loading must not race: the catalog is loaded only for Cloud-only/home browsing,
or after an explicit browse action when the Local workspace has neither a
binding nor a canonical target candidate.

## Issuance and rotation API shape

The server returns locator metadata and the one-time secret separately:

```json
{
  "remote": {
    "url": "https://host/git/project-id/scopes/scope-id.git",
    "project_id": "project-id",
    "scope_id": "scope-id",
    "kind": "scoped",
    "username": "x-puppyone-token"
  },
  "credential": "pwg_...",
  "grant_mode": "r",
  "credential_expires_at": null
}
```

Root responses use `/git/{project_id}.git` and may return the canonical root
Scope ID as metadata.  Ordinary reads redact the secret.  Rotation returns a
new secret once and the same locator.  Clients never construct a credential URL
by replacing path text.

## Error and observability contract

- Missing, invalid, expired, revoked, wrong-Project, wrong-Scope, wrong-kind,
  and mismatched-binding credentials use one non-disclosing authentication
  failure.
- A valid read-only grant attempting a write uses the normal Git permission
  failure/report-status path.
- Authorization headers and credential-helper payloads are always redacted.
- Legacy secret path segments are never logged verbatim.
- Structured events carry request ID, action/outcome/reason, and one-way
  Project/Scope references, not names, paths, user IDs, or credentials.
- Credential resolution happens before opening repo state or warming a cache.

## Legacy `/git/ap/<access_key>.git` migration

The legacy route is a compatibility adapter, not the target architecture.

### Additive rollout

The implementation deploys in this order:

1. expand the credential schema and transactional resolver;
2. deploy canonical scoped routes and make the Project route root-only;
3. deploy standard Basic challenge and exact RuntimeGrant resolution;
4. keep the old route operational with access-log path redaction and one-way
   usage counters;
5. make every new issuance return canonical locator plus separate credential;
6. convert Web, Desktop, Sandbox, CLI guidance, and internal jobs;
7. observe and repair before any contract/removal phase.

The expand migration is intentionally forward-only during this window. A
service rollback does not drop `grant_mode`, `credential_lifecycle`, new
credential rows, or RPCs.
Canonical ingress remains enabled once clients have received canonical-only
credentials; after that point an incident is repaired forward rather than by
forcing users back to secret-bearing URLs.

### First-party conversion

For an existing legacy remote, the client:

1. extracts the key locally without logging it;
2. resolves the legacy credential to Project/Scope;
3. verifies current human access when a human session exists;
4. stores the credential through the Git credential helper;
5. rewrites the remote to the canonical locator;
6. verifies `git ls-remote` against the canonical remote;
7. removes the secret-bearing URL only after verification.

The server does not redirect a secret-bearing path to a canonical URL.  A
redirect can leak credentials and produces inconsistent Git auth forwarding.

### Retirement gate

The legacy route is removed only through a separate approved contract change
after all first-party clients have migrated, redacted usage remains zero for
the agreed window, configuration scans find no first-party secret URLs, and
rollback no longer depends on the old route.

The exact go/no-go queries and canary matrix are normative operational guidance
in the rollout runbook. Archiving this OpenSpec change does not authorize route
removal; removal is a new breaking change.

## PuppyOne Cloud Git behavior

PuppyOne Cloud exposes one workspace view through `refs/heads/main`; it is not a
GitHub-style pull-request surface.

| Capability | Product action | Support | Product rule |
| --- | --- | :---: | --- |
| Clone | Clone from Cloud | Yes | Create a local checkout of the authorized root/Scope view. |
| Fetch | Refresh Cloud Status | Yes | Refresh remote knowledge without changing the working tree. |
| Download | Pull/rebase | Yes | Use fast-forward or rebase; preserve staged/tracked edits. |
| Upload | Push `HEAD:main` | Yes | Accept only against the current Git-visible Scope head. |
| Force push | Overwrite Cloud | No | Client cannot overwrite canonical history. |
| Merge commit to main | Upload merge | No | Product-visible main remains linear. |
| Delete main | Delete history | No | Rollback is a product operation. |
| Git LFS | LFS pointer blobs | No | Use PuppyOne object/upload APIs for large binaries. |
| Branch/tag refs | Advanced transport metadata | Limited | Do not advance product-visible main. |
| Same-Scope conflict | Rebase locally | Yes | Second stale push receives non-fast-forward. |
| Cross-entrypoint conflict | Hosted review/policy | Yes | Resolved by Version Engine policy. |
| Health | Diagnose Git view | Yes | Uses the same GitViewHead as clone/fetch/push. |
| Rebuild cache | Repair derived view | Admin/hidden | Rebuilds only from canonical committed facts. |

Desktop maps the contract to two primary actions:

```text
Download:
  fetch puppyone
  pull --ff-only --autostash, or pull --rebase --autostash

Upload:
  push puppyone HEAD:main
  disable/reject when Cloud has a newer visible head
```

Product/API saves do not run Git transport.  They submit typed tree splices to
the same Version Engine publish boundary.
