# Project Authorization and Workspace Binding

Status: **current architecture** (ISSUE-029)

This document is the source of truth for PuppyOne's Organization, Project,
Agent-child, local workspace binding, and machine runtime boundaries.  Git
remotes and credentials transport content; they never grant human control-plane
access or identify a local folder as a Cloud Project.

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
6. `repo_scopes`
7. `access_surfaces`
8. `access_surface_credentials`
9. `access_surface_policies`

`project_members` is the only explicit human Project-role fact.
`repo_user_permissions` is removed after a blocking, deterministic migration.
Adjacent business tables such as `tools`, `access_tools`, Version Engine
transactions, content, and audit are not alternate authorization sources.

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
binding id, Cloud origin, Project id, Scope id,
workspace instance id, bound user id, full/scoped kind,
r/rw requested runtime mode, lifecycle timestamps
```

It does not store an absolute local path, folder fingerprint, remote URL,
plaintext credential, role, or capability snapshot.  One workspace instance
has at most one active binding.  Rebinding requires explicit detach/revoke.

- `full` requires the canonical root scope.
- `scoped` requires a non-root scope and exposes its path in the UI.
- changing the root identity of a scope with an active binding is rejected.
- changing a scope from `rw` to `r` revokes active `rw` binding credentials.
- Viewer can mint only `r`; Editor/Admin can request `r` or `rw`, still capped
  by the current scope.

Each binding receives an independent, hash-only credential.  Shared surface
key rotation excludes binding credentials; binding rotation/revoke affects only
that workspace.  Membership loss, role downgrade, scope downgrade, surface
disable, or binding revoke is rechecked on the next machine request.  Triggered
revocation is defense in depth, not a replacement for request-time checks.

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

## Git and Claude readiness

Readiness is a projection of durable facts, not a mutable Project flag:

```text
active canonical-root git_remote surface
AND valid canonical root head
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
- Desktop tests cover full/scoped binding, wrong account/host, legacy
  confirmation, capability navigation, and the first-root-Git-push Claude gate.

Deployment and rollback gates are defined in
[ISSUE-029 authorization cutover](../ops/issue-029-authorization-cutover.md).
