# Git Remote Locator, Credential, and Access Surface Contract

Status: **normative current contract** (ISSUE-039).

Repository ownership and relational details are defined in
[Project-Owned Repository Targets](15-project-owned-repository-targets.md).
Version transaction semantics are defined in
[Version Engine](01-version-engine.md).

## Facts that remain separate

```text
Canonical Git locator  -> declares a non-secret RepositoryTarget
Git credential         -> authenticates one bounded machine RuntimeGrant
Human JWT              -> authorizes named Project control-plane actions
Workspace Binding      -> identifies one local workspace/Cloud target pairing
```

None substitutes for another. In particular, a remote URL or valid Git token
does not grant Human Project access, and a Human JWT is not passed through Git
transport authentication.

## Canonical locators

Project root:

```text
https://<cloud-origin>/git/{project_id}.git
```

Exact Scope view:

```text
https://<cloud-origin>/git/{project_id}/scopes/{scope_id}.git
```

The Project root is the complete canonical Project repository. It is not a
Scope row. A Scope locator is a deliberate subtree view over the same object
store and canonical history. A Desktop checkout of a complete hosted Project
MUST use the Project-root locator.

IDs use one canonical encoded form. Locators reject credentials, userinfo,
query strings, fragments, percent-encoded route identity, extra path segments,
and secret-bearing compatibility paths. The Git username is
`x-puppyone-token`; the opaque secret is supplied by a credential helper or
HTTP auth and never appears in the URL.

## Smart HTTP

Each canonical locator supports stock Git endpoints:

```text
GET  <locator>/info/refs?service=git-upload-pack
POST <locator>/git-upload-pack
GET  <locator>/info/refs?service=git-receive-pack
POST <locator>/git-receive-pack
```

Health/cache operations reuse the same resolved view. Signed-in Web uses the
Project control plane:

```text
GET  /api/v1/projects/{project_id}/git-view/health
POST /api/v1/projects/{project_id}/git-view/rebuild-cache
```

Web diagnostics do not send a Human JWT to Git data-plane routes.

## Credential model

Git credentials are `access_surface_credentials` rows attached to an active
`git_remote` Access Surface. They store only hash, prefix/last-four display
metadata, lifecycle, grant mode, expiry/revocation state, and optional
Workspace Binding. Plaintext is returned exactly once.

The Surface target is represented by `(project_id, nullable scope_id)`:

- NULL `scope_id`: `ProjectRootTarget(project_id)`;
- non-NULL `scope_id`: `ScopeTarget(project_id, scope_id)`.

Shared Surface, expiring session, and Workspace Binding credentials are
separate revocation domains. Rotation of one domain cannot revoke unrelated
sessions or bindings.

## Exact runtime resolution

Canonical Git authentication is a single-snapshot operation:

```text
route Project/Scope
  + credential hash
    -> credential status/type/expiry
    -> active git_remote Surface
    -> exact target
    -> optional active Binding and current bound-user Project role
    -> Scope geometry and descendant exclusions, when scoped
    -> effective mode
    -> immutable RuntimeGrant + ResolvedRepositoryView
```

The resolver must prove:

- route target equals Surface target;
- credential Project/Organization equals Surface Project/Organization;
- a Binding credential equals the Binding target and user;
- the current Human Project grant still permits the requested binding mode;
- a Scope exists in the same Project and caps mode;
- Project root has empty path, no excludes, and no Scope identity;
- the requested Surface is active and the credential is not revoked/expired.

Unknown credentials, route mismatch, Project mismatch, Scope mismatch, and
malformed resolver facts all produce the same Git 401. This prevents target
enumeration. Storage failure is not “not found” and must not widen authority.

For a parent Scope, descendant Scope paths are included in the resolved
exclusions. Downstream Git code consumes the snapshot and does not re-query
canonical identity. The bounded `/git/ap/<secret>.git` adapter remains only for
already-issued legacy Access keys; first-party code never constructs it. Its
secondary topology lookup is fail-closed and its use is redacted telemetry.

## Effective authority

The effective mode is the minimum of:

```text
credential grant mode
Surface policy/mode
Scope max_mode, when scoped
Workspace Binding mode, when bound
current bound-user Project capability, when bound
```

Human Project-root diagnostics separately derive read/write/repair capability
from `ProjectGrant`. A Project-root repository view has an `rw` capability
ceiling, but a Viewer or read-only credential still receives effective `r`.

Pause is an operational Access Surface gate. Membership, target, mode,
excludes, credential state, and Binding checks remain the security boundary.
CLI command policy is fail-closed and keyed by exact Project + Scope + provider.

## Version Engine boundary

After authentication, all routes converge on one resolved target adapter:

```text
ResolvedGitTarget
  -> Project-shared server repo
  -> RepoFacade from ResolvedRepositoryView
  -> advertisement / fetch / push / health
  -> canonical CAS transaction, history, audit, and outbox
```

There is one object database and canonical Project history. A Scope push is
validated against its path/excludes, spliced into the Project tree, and
committed through the same transaction engine as Project-root and Product
writes. Empty path in ref/cache/history state means Project-root projection;
it is not a persisted Scope.

Clone/fetch must not advertise or serve objects outside the resolved view.
Push rejects unadvertised objects, excluded/sibling writes, stale non-fast-
forwards, unsupported merge commits, LFS pointers without LFS support, malformed
packs, and attempts exceeding enforced limits. Rejection cannot advance refs,
history, audit success state, or canonical Project root.

## Issuance API

Issuance returns locator and one-time secret separately:

```json
{
  "target": {
    "kind": "scope",
    "project_id": "project-1",
    "scope_id": "scope-docs"
  },
  "git_url": "https://cloud.example/git/project-1/scopes/scope-docs.git",
  "git_username": "x-puppyone-token",
  "credential": "git_<one-time-secret>",
  "grant_mode": "r"
}
```

Ordinary list/read/health/binding responses never return the secret. Rotation
changes only credential facts; it does not change target or locator. Creating a
Scope does not implicitly create a Git Surface. The explicit enable-target
action idempotently and atomically ensures standard Git and CLI Surfaces.

## Workspace discovery and repair

Desktop persists Cloud origin, Project ID, Binding ID, and workspace instance
ID in secret-free config. Git config stores the canonical remote; the operating
system/Git credential helper stores the secret.

On Cloud-page entry Desktop verifies:

```text
session -> Binding -> current Project authorization
        -> Binding target == canonical remote target
        -> origin and workspace instance match
        -> Project readiness/content
```

A missing remote does not erase a valid Binding: content opens with a Repair
connection action. Detach explicitly revokes/clears Binding identity and
returns the workspace to local-only. A repository never hosted or bound to
PuppyOne has neither Cloud config nor PuppyOne remote and renders local-only
without an error banner.

## Readiness

Claude readiness is a projection of durable facts, not a Scope flag:

```text
active Project-root git_remote Surface
AND valid Project-root Version state
AND committed root Git transaction from source_channel = access_git
```

A Product/API seed, rejected push, or Scope push cannot impersonate the first
Project-root Git push. Readiness returns machine-readable blockers. Session
generation changes are retried/normalized by Desktop and never shown as raw
`SESSION_CHANGED` text.

## Protocol and observability

Affected first-party control-plane APIs require
`X-PuppyOne-Repository-Contract: 2`; missing or wrong versions return 426.
Typed target errors distinguish target mismatch, missing Scope, and repository
storage unavailability. Git target mismatch stays a uniform 401.

Audit records include source channel, protocol, entry point, immutable runtime
principal, Surface/Binding IDs, target, mode, ref, and redacted actor
attribution. Logs and metrics never contain raw credentials or secret-bearing
paths. The legacy route reports only one-way Project/Scope references and is
removable when its accepted-request counter remains zero for the retirement
window.

## Verification contract

Required tests cover canonical locator parsing, hash-only one-snapshot
resolution, root and Scope clone/fetch/push with stock Git, credential-helper
use, descendant isolation, read-only enforcement, Binding continuity,
concurrent pushes, malformed/oversized requests, one-time secret redaction,
contract-v2 gating, Desktop repair/detach/local-only states, and architecture
guards against synthetic root identity or `_scope` reconstruction.
