# Project Authorization and Workspace Binding

Status: **current authorization and canonical Git binding architecture**
(ISSUE-029). The implementation record is tracked by OpenSpec change
[`refactor-canonical-git-remote-contract`](../../backend/openspec/changes/refactor-canonical-git-remote-contract/design.md).

This document is the source of truth for PuppyOne's Organization, Project,
Agent-child, local workspace binding, and machine runtime boundaries.  Git
credentials transport content and grant only a bounded machine RuntimeGrant. A
trusted canonical Git locator may identify one deterministic Project/Scope
candidate, but it never grants human control-plane access and never becomes the
durable identity of a local folder. Only WorkspaceBinding supplies that local
identity.

## The three decisions

```text
Human JWT
  -> Organization membership          tenant / billing / entitlement boundary
  -> ProjectGrant                     Project action ceiling
  -> Agent or child-resource policy   optional narrowing only

Machine credential
  -> RuntimeGrant                     one surface + scope + mode + policy

Local workspace
  -> WorkspaceBinding                 identity only; grants nothing
```

These decisions are deliberately independent:

- Organization membership does not imply Project edit permission.
- ProjectGrant is required before an Agent visibility rule is evaluated.
- Agent visibility can hide a child; it cannot admit a denied Project user.
- A binding says which Cloud Project a local workspace represents; every
  request still re-authorizes the current account.
- A canonical Git locator may remove Project-list scanning by declaring one
  Project/root-or-Scope candidate; current JWT authorization and a matching
  binding are still required before normal bound-Project navigation.
- A Git, CLI, MCP, Sandbox, Agent, or binding token cannot call Team, Billing,
  Project Members, Project Settings, or credential-management APIs.

## Canonical human policy

`backend/src/platform/authorization/AuthorizationService` is the only Project
policy decision point.  It reads facts through `AuthorizationRepository` and
returns an immutable `ProjectGrant`.

Resolution order is exact:

1. missing Organization membership: deny;
2. Organization owner: Admin, source `org_owner`;
3. valid explicit `project_members` row: its Admin, Editor, or Viewer role;
4. `projects.visibility = 'org'`: Viewer, source `org_visibility`;
5. otherwise: deny.

Unknown roles, a member row from another tenant, a fact for a different
Project, or a repository error fail closed.  Private Project denial is returned
as not-found on ordinary resource APIs to avoid metadata disclosure.

### Fixed capability contract

| Capability group | Viewer | Editor | Admin |
| --- | :---: | :---: | :---: |
| Project/content/history/Agent read | yes | yes | yes |
| Content write and history restore |  | yes | yes |
| Agent and Automation run |  | yes | yes |
| Read-only local binding | yes | yes | yes |
| Read-write local binding |  | yes | yes |
| Agent/Automation/Integration/Scope/Access manage |  |  | yes |
| Project settings, members, share, secrets, delete |  |  | yes |

Code authorizes a named `ProjectAction`; it never branches on a truthy raw
role.  The FastAPI route/action inventory lives in
`platform/authorization/manifest.py`.  CI compares it with the actual route
registry, including Project IDs carried in paths, query parameters, bodies, or
resource-derived routes.

Project list and detail responses include `effective_role`, `grant_source`, and
`capabilities`.  Candidate discovery may use Organization indexes, but the
canonical batch policy filters the result before Project metadata or child
counts are returned.

## Persistence model

The authorization/binding/runtime boundary has nine core tables:

1. `organizations`
2. `org_members`
3. `projects`
4. `project_members`
5. `project_workspace_bindings`
6. `repository_scopes`
7. `access_surfaces`
8. `access_surface_credentials`
9. `access_surface_policies`

`project_members` is the only explicit human Project-role fact.
`repo_user_permissions` is removed after a blocking, deterministic migration.
Adjacent business tables such as `tools`, `access_tools`, Version Engine
transactions, content, and audit are not alternate authorization sources.

Project root is represented by Project plus nullable `scope_id`; it has no
Scope row. Every `repository_scopes` row is a non-empty path boundary.
Composite foreign keys prove Project/Organization, Scope/Project,
Surface/Project/Organization, Binding/Project/Scope/User, and credential/surface
integrity in the database.  Project creation and creator Admin membership use
one RPC transaction.  Member mutations re-authorize Admin at commit time and
write their audit row in the same transaction.

`access_tools` is a child-resource boundary: a Project surface may bind a tool
from the same Project or a tenant-level tool from the same Organization.  A
sibling-Project or cross-tenant tool is rejected by both service code and a
database trigger.

## Workspace binding

`project_workspace_bindings` stores only stable, non-secret facts:

```text
binding id, Cloud origin, Project id, nullable Scope id,
workspace instance id, bound user id,
r/rw requested runtime mode, lifecycle timestamps
```

It does not store an absolute local path, folder fingerprint, remote URL,
plaintext credential, role, or capability snapshot.  One workspace instance
has at most one active binding.  Rebinding requires explicit detach/revoke.

- NULL Scope means `ProjectRootTarget`; a non-NULL Scope means the exact
  `ScopeTarget`. The target kind is derived, never stored separately.
- changing a binding target requires explicit detach/rebind.
- changing a scope from `rw` to `r` revokes active `rw` binding credentials.
- Viewer can mint only `r`; Editor/Admin can request `r` or `rw`, still capped
  by the current scope.

Each binding receives an independent, hash-only credential.  Shared surface
key rotation excludes binding credentials; binding rotation/revoke affects only
that workspace.  Membership loss, role downgrade, scope downgrade, surface
disable, or binding revoke is rechecked on the next machine request.  Triggered
revocation is defense in depth, not a replacement for request-time checks.

Credential revocation domains are explicit in
`access_surface_credentials.credential_lifecycle`: `shared` identifies the
manual surface slot, `session` identifies a separately expiring runtime token,
and `binding` requires `workspace_binding_id`. This prevents a shared-key
rotation from revoking active Sandbox sessions or unrelated workspaces.

Desktop persists only:

```json
{
  "project": { "workspaceInstanceId": "stable-local-instance" },
  "cloud": {
    "origin": "https://cloud.puppyone.ai",
    "projectId": "project-id",
    "bindingId": "binding-id"
  }
}
```

The credential is returned once and written only into the Git credential form
of the configured remote.  It is never written into the shared PuppyOne
manifest.

### Canonical Git locator discovery

The current Git locator contract is defined normatively in
[Git Remote Locator, Credential, And Access Point Contract](05-git-remote-accesspoint.md):

```text
Project root  /git/{project_id}.git
Scoped view   /git/{project_id}/scopes/{scope_id}.git
```

The IDs are non-secret locators. The credential is a separate opaque secret
stored through the Git credential helper. The four decisions remain separate:

```text
locator          -> one Project/Scope candidate
Git credential   -> machine RuntimeGrant only
human JWT        -> ProjectGrant only
WorkspaceBinding -> durable local workspace identity only
```

The same split applies to Git-view diagnostics. Locator-relative
`/git/.../health` and `/git/.../rebuild-cache` remain machine RuntimeGrant
operations. A signed-in Web client uses the root-only Project control plane at
`GET /api/v1/projects/{project_id}/git-view/health` (Project Read) and
`POST /api/v1/projects/{project_id}/git-view/rebuild-cache` (Project Manage).
The adapter reuses the Version Engine's derived view implementation, but never
passes a human JWT through Git transport auth. The returned `can_rebuild` fact
is evaluated from the current ProjectGrant; UI code must not guess it from a
raw role.

Desktop open behavior follows this order:

1. read the secret-free PuppyOne remote and local workspace identity;
2. parse a candidate only when the remote uses a configured trusted Cloud
   origin and canonical locator grammar;
3. resolve the active binding when its ID is present;
4. re-authorize the current account against the binding's Project;
5. verify exact Project-root/Scope target, host, and workspace instance;
6. navigate directly to the verified Project without enumerating Organization
   Projects first.

The Desktop Project-catalog hook is disabled during Local workspace session
restore. It may enumerate Projects only for Cloud-only/home browsing, or when
the user explicitly browses from an unbound Local workspace with no canonical
target candidate. This prevents a broad catalog request from racing and
visually winning over exact binding resolution.

The explicit `Use here` action already owns the selected Project ID. It calls
Workspace Binding creation with that ID and accepts the canonical remote from
the binding response; it must not prefetch Repo Identity or enumerate Scopes
merely to rediscover a URL that the binding service owns.

If local binding state is absent, a canonical locator can seed one explicit
attach/recovery flow after current-user authorization. It cannot silently
create durable identity, cannot authorize Project metadata, and cannot trigger
an N-by-M scan of Projects, Scopes, or shared credentials. The bounded legacy
`/git/ap/<key>.git` adapter is never constructed by first-party clients because
its path is a secret-bearing capability rather than a stable locator.

Binding or Access issuance returns the canonical locator and one-time
credential as separate fields. Rotation changes the credential but never the
locator or binding identity. A local configuration failure after server-side
issuance must retain enough non-secret binding identity to retry or revoke; it
must not leave an unreported active binding.

## Git and Claude readiness

Readiness is a projection of durable facts, not a mutable Project flag:

```text
active Project-root git_remote surface
AND valid Project-root head
AND committed Version Engine transaction
    where scope_path = '' and source_channel = 'access_git'
```

The third condition matters: a Product/API edit or seed can create a root head,
but it cannot impersonate the user's first root Git push.  A rejected push, a
non-root push, a non-root head, or Project metadata alone never unlocks Claude.

The readiness endpoint returns `git_not_created`, `awaiting_first_push`, or
`ready`, with machine-readable blockers.  Desktop does not create or load the
Claude/Project Agent runtime unless `claude.ready` is true.  A scoped checkout
remains ineligible even if the parent Project is ready.

## Request and worker enforcement

- HTTP Project routes use `require_project_action` or an injected
  `AuthorizationService` before business reads/mutations.
- Resource-ID routes resolve the parent Project, authorize it, then apply child
  ownership/visibility.
- Version Engine human entry points use Project actions; Git/AP-FS machine
  entry points use RuntimeGrant.  The SQL write-state resolver uses the same
  effective-role precedence as the application as a TOCTOU defense.
- Scheduler and internal worker entry points build the same Authorization
  Service explicitly because they do not run inside FastAPI dependency
  injection.  They must carry a human principal or a bounded runtime principal;
  “internal” is not an allow decision.
- Request-scoped grant memoization is permitted.  Cross-request role caching is
  not used, so revocation takes effect on the next request.

## Observability and failure behavior

Authorization emits structured allow/deny facts containing action, outcome,
reason, role/source when present, and a one-way shortened Project reference.
It never emits user IDs, raw Project IDs, names, paths, content, or credentials.
Fact-store failures emit only the exception type and fail closed.

Unknown actions and missing route contracts fail CI.  List/batch fact failures
return no Projects rather than a partial metadata leak.

## Verification

- Python policy tests exercise the real PDP with static facts, including
  private/org-visible, mismatched tenants/Projects, role monotonicity, and
  repository failure.
- Architecture tests reject legacy guards, duplicate human permission reads,
  ambiguous Project access helpers, and unregistered Project routes.
- `supabase/tests/unified_project_authorization_test.sql` exercises real RPCs,
  FKs, triggers, role resolution, credential isolation, scope/role downgrade,
  and tool child boundaries through pgTAP.
- Desktop tests cover Project-root/Scope binding, wrong account/host, legacy
  confirmation, capability navigation, and the first-root-Git-push Claude gate.

Deployment and rollback gates are defined in
[ISSUE-029 authorization cutover](../ops/issue-029-authorization-cutover.md).
