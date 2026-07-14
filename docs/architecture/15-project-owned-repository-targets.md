# Project-Owned Repository Targets

Status: **normative final architecture** (ISSUE-039).

This document defines repository identity, Scope geometry, Access Surface
targets, Workspace Binding targets, and the Cloud/Desktop lookup flow. It is
the source of truth when older documents use “root scope” as shorthand for an
empty-path Version Engine projection.

## Core invariant

One Project owns exactly one canonical Git repository, object store, commit
history, and ref namespace. A Scope is a path-bounded view of that repository;
it is not another repository and does not grant Human Project access.

```text
Organization                         tenant, membership, billing
  └── Project                        ownership and Human authorization boundary
      ├── Canonical Git Repository   one object database, history, and refs
      │   └── Project Root View      target = ProjectRootTarget(project_id)
      │       └── /git/{project_id}.git
      │
      └── Repository Scopes          optional non-empty path boundaries
          ├── Scope: company
          │   └── /git/{project_id}/scopes/{scope_id}.git
          └── Scope: company/sales
              └── /git/{project_id}/scopes/{scope_id}.git
```

Project existence implies root repository identity. No root row, sentinel ID,
`is_root` flag, target super-table, or duplicated `binding_kind` is allowed.

## Identity versus projection

The domain identity is a closed union:

```text
RepositoryTarget =
    ProjectRootTarget(project_id)
  | ScopeTarget(project_id, scope_id)
```

Operational code consumes an immutable projection:

```text
ResolvedRepositoryView
  target
  path_prefix
  excludes
  max_mode
  ref
```

The only valid Project-root view is:

```text
path_prefix = ""
excludes    = []
max_mode    = "rw"       # capability ceiling, not the caller's effective mode
```

A Scope view has a non-empty `path_prefix`; its excludes and maximum mode come
from the current `repository_scopes` row. Hosted Agent or Sandbox jobs may add
an operational `RepositoryPathProjection` beneath a target. That projection is
execution policy and MUST NOT create a synthetic Scope identity.

## Relational model

```text
organizations
  1 ───── * projects
              │
              ├── 1 ───── * repository_scopes
              │             id, project_id, non-empty path, excludes, max_mode
              │
              ├── 1 ───── * access_surfaces
              │             project_id, scope_id NULLABLE, kind, status, policy
              │                        │
              │                        └── * access_surface_credentials
              │                             hash-only secret, lifecycle, mode
              │
              └── 1 ───── * project_workspace_bindings
                            project_id, scope_id NULLABLE, instance, user, mode
```

`scope_id IS NULL` means Project root. A non-NULL value means the exact Scope
in the union. Persistence adapters are the only layer that maps nullable
storage to the domain union.

Database integrity MUST include:

- an ordinary Project foreign key for every target-bearing row;
- `(scope_id, project_id) -> repository_scopes(id, project_id)` composite FKs;
- canonical, non-empty, Project-unique Scope paths;
- `NULLS NOT DISTINCT` uniqueness for one built-in Surface per target and kind;
- tenant-consistent Organization/Project/Surface/Binding/credential chains;
- no target-kind column whose value can disagree with nullability;
- no credential material in Scope, Surface config, Binding, or response lists.

The existing entitlement catalog key `repo_scopes.max_per_project` remains a
billing identifier for compatibility; it is not a database table name or a
repository identity contract.

## Authorization boundaries

Human control plane:

```text
JWT -> Organization context -> ProjectGrant -> named ProjectAction
                                    └── optional Scope geometry narrows only
```

Machine data plane:

```text
credential hash
  -> active Access Surface
  -> exact RepositoryTarget
  -> optional active Workspace Binding + current Human Project access
  -> ResolvedRepositoryView
  -> RuntimeGrant
  -> Version Engine admission
```

A URL, Project ID, Scope ID, Git credential, Access Surface, RuntimeGrant, or
Workspace Binding never creates Human Project membership. Route, credential,
Surface, Binding, Project, and Scope facts must agree before content access.

## Access Surface lifecycle

Creating a Scope creates only geometry. Git and CLI are enabled by an explicit,
authorized, idempotent target action. The action atomically ensures the
standard Surface set and is concurrency-safe; a Scope read must never create
Surfaces as a side effect.

Project-root and Scope Surfaces use the same table and lifecycle. Their
difference is the target, not a separate resource type. Shared, session, and
binding credentials have separate revocation domains. Secrets are returned
once, stored hash-only, and never embedded in canonical Git URLs.

## Git locator and credential contract

```text
Project root  https://cloud.example/git/{project_id}.git
Scope view    https://cloud.example/git/{project_id}/scopes/{scope_id}.git
```

The locator declares a non-secret target. HTTP Basic/Bearer authentication
carries a separate opaque credential. Clone always uses the Project root when
the intent is a complete local Project workspace. A Scope locator is used only
for a deliberately delegated subtree checkout.

The server resolves a canonical Git request in this order:

```text
1. Parse and canonicalize the route target.
2. Extract the HTTP credential and hash it before lookup.
3. In one database snapshot resolve credential, Surface, target, optional
   Binding/current Project role, Scope geometry, descendant exclusions, and
   effective mode.
4. Require route target == Surface target == Binding target.
5. Build one immutable RuntimeGrant and ResolvedRepositoryView.
6. Pass only that view to Git advertisement, fetch, health, or push admission.
```

Downstream adapters MUST NOT reconstruct identity from `_scope` dictionaries
or issue a second canonical Scope query. A legacy Access-key compatibility
adapter may resolve descendant carving separately, but lookup failure must
return unavailable and never silently omit exclusions.

## Cloud page and Desktop flow

When a user opens the Cloud/Claude page, the Desktop flow is:

```text
Local workspace
  ├── secret-free config: cloud origin, project ID, binding ID, instance ID
  └── Git config: canonical puppyone remote; credential helper stores secret
          │
          v
Desktop main process (sole credential owner)
  -> restore current Cloud session
  -> resolve Workspace Binding by binding ID
  -> authorize current user against binding.project_id
  -> compare binding target, canonical remote target, origin, and instance ID
  -> fetch Project readiness and content state
  -> renderer receives structured state, never credentials
```

Expected states are distinct:

- no Cloud config and no PuppyOne remote: local-only, no error banner;
- active binding and matching canonical remote: enter Project content;
- active binding but canonical remote missing: enter content with repair action;
- Scope target deleted: typed `SCOPE_NOT_FOUND`, offer detach/recovery;
- wrong account, origin, Project, target, or instance: fail closed with an
  explicit identity state;
- transient service/storage failure: retryable unavailable state, preserving
  the last verified binding;
- detached binding: clear Cloud binding facts; the workspace becomes local-only.

Session generation changes are transport/session concerns and must be retried
or rendered as a generic retryable state. They are not repository-binding
states and raw `SESSION_CHANGED` text must never reach a user.

## API and protocol contract

Affected first-party APIs require:

```text
X-PuppyOne-Repository-Contract: 2
```

Missing or wrong versions return HTTP 426 with `CLIENT_UPGRADE_REQUIRED`.
Public target payloads are exactly one of:

```json
{"kind":"project_root","project_id":"project-1"}
```

```json
{"kind":"scope","project_id":"project-1","scope_id":"scope-docs"}
```

Stable repository contract errors are:

| Code | Meaning |
| --- | --- |
| `1007 CLIENT_UPGRADE_REQUIRED` | Client does not speak contract v2 |
| `1008 TARGET_KIND_MISMATCH` | Declared target disagrees with route/Project |
| `1009 SCOPE_NOT_FOUND` | Exact Scope target no longer exists |
| `1010 REPOSITORY_STORAGE_UNAVAILABLE` | View cannot be resolved without widening |

Git authentication deliberately maps unknown credential and target mismatch to
one non-enumerating 401 response. Git/CLI transport failures expose stable
repository error codes through `X-PuppyOne-Error-Code` while preserving their
transport-specific response bodies.

## Version Engine state

Empty path remains a valid internal view coordinate in ref, transaction,
history, cache, and audit records. It means “Project root projection”; it is
not a Scope resource. All targets share the Project object store and canonical
history. Scoped pushes splice their subtree into the Project tree and publish
through the same CAS/transaction/audit/outbox boundary as Project-root and
Product writes.

Parent Scope views exclude declared descendant Scope paths. The Project-root
view does not carve descendants because it represents the complete Project.
Failure to resolve descendant topology is fail-closed.

## Release and verification

The cutover is a destructive contract migration guarded by an immutable
read-only data preflight. It maps former root references to NULL, preserves
non-root Scope and credential IDs, deletes root sentinel rows, renames the
table, installs final constraints/RPCs, and verifies continuity.

Required evidence includes fresh install, previous-schema upgrade, idempotent
preflight, dirty-data rejection without receipt or mutation, concurrent target
enable convergence, credential continuity, root/scoped real Git, Web/Desktop
contract fixtures, and architecture scans rejecting legacy identity fields.
Production application rollback after Contract is forbidden without the
database restore point and matching previous application. Forward-fix and
restore procedures are documented in the ISSUE-039 cutover runbook.
