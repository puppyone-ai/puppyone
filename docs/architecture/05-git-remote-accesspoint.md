# Git Remote Locator, Credential, and Access Contract

This document is the normative contract for PuppyOne Git hosting and Desktop
Cloud discovery. It separates three concerns that must never be collapsed:

1. a canonical URL locates a repository target;
2. a current human session authorizes Cloud UI actions;
3. an independent Git credential authorizes smart-HTTP data-plane actions.

The Cloud does not register, attest, inventory, or identify a local device,
folder, checkout, or Desktop workspace instance.

## Resource model

```text
Organization                         ownership, membership, billing
└── Project                          canonical authorization boundary
    ├── Canonical Git Repository     one object database, commit graph, refs
    │   ├── Project-root view        target { kind: project_root, project_id }
    │   └── Scoped views             target { kind: scope, project_id, scope_id }
    ├── ProjectGrant                 current human control-plane authority
    └── Access Surfaces
        └── Git Surface
            └── Git credentials      independent, hash-only runtime principals
```

A Scope is path geometry and an authorization restriction inside the canonical
Project repository. It is not a second repository and does not own a separate
object database.

## Canonical locators

```text
Project root: /git/{project_id}.git
Scope view:   /git/{project_id}/scopes/{scope_id}.git
```

The URL contains only non-secret target identity. Credentials are supplied by
Git HTTP authentication and must never appear in a newly generated URL.

Desktop accepts a canonical remote as Cloud context only when all of these hold:

- exactly one PuppyOne canonical target is present;
- its origin matches the configured Cloud Git origin;
- the URL parses to a normal Project-root or Scope target;
- the current JWT authorizes that Project and exact target.

No canonical remote means `local-only`. Desktop makes no repository-context API
request and renders no Cloud error. A legacy secret-bearing route may still be
served by the Git transport during its bounded compatibility window, but it is
never a Cloud UI locator.

## Cloud UI resolution

```text
User opens Cloud view
  -> Desktop reads actual Git remotes
  -> no unique canonical PuppyOne remote?
       -> local-only; stop; no Cloud request
  -> Desktop parses { project_id, optional scope_id }
  -> POST /api/v1/projects/{project_id}/repository-context
       body: { target }
       auth: current human JWT
  -> Backend checks path Project ID == target Project ID
  -> AuthorizationService resolves current ProjectGrant
  -> Scope target is loaded and checked inside the same Project
  -> return secret-free Project context and capabilities
  -> render Project content
```

The backend does not receive a local path, workspace ID, device ID, checkout
ID, Git credential, or raw remote URL on this path. The canonical URL is a
locator, not proof. A stale project ID in any local manifest is not a fallback.

## Git data-plane authorization

```text
git fetch / push
  -> canonical route resolves requested target
  -> HTTP credential is hashed before lookup
  -> credential resolves owner + exact Git Access Surface + target + mode
  -> current membership/role is re-evaluated
  -> effective mode = min(
       credential ceiling,
       Surface policy,
       Scope max_mode,
       current ProjectGrant
     )
  -> RuntimeGrant enters Git transport
```

The route target and credential target must match exactly before repository
metadata or object state is opened. A RuntimeGrant cannot enter Team, Billing,
membership, sharing, Project settings, or credential-management APIs.

## User Git credentials

An authenticated Project member may issue a credential for one exact target and
mode through:

```text
POST /api/v1/projects/{project_id}/git-credentials
DELETE /api/v1/projects/{project_id}/git-credentials/{credential_id}
```

The issue response reveals plaintext once. Storage contains only a keyed hash,
prefix/last-four hints, owner user ID, Project, Access Surface, target mode,
status, and timestamps. It contains no local-client identity.

Multiple clients may hold independent credentials for the same user and target.
Revoking one credential does not revoke the others. Removing a local remote is
a local Git operation and does not imply credential revocation. If Desktop
fails to configure a remote immediately after issuing a credential, it performs
a best-effort compensating revocation of that newly issued credential.

Membership loss invalidates user credentials on their next request. A role
downgrade dynamically caps an existing read-write credential to read-only;
credential rows are not rewritten merely because a role changed.

## Local state

Git config is authoritative for Cloud discovery:

```text
remote "puppyone" -> canonical locator
credential helper -> plaintext secret under operating-system protection
```

The shared workspace config may store sync, backup, branch, and preferred remote
settings. It must not store Cloud authorization, a server-issued checkout ID,
or a secret. `workspaceInstanceId` is a local application concern only and
never crosses the Cloud API boundary.

## Failure semantics

- no canonical remote: local-only, no error;
- more than one canonical target: local conflict with repair guidance;
- wrong host: reject before sending a Cloud request;
- 401: sign-in/session recovery;
- 403: current account lacks Project access;
- 404: Project or Scope no longer exists;
- transport outage: temporary-unavailable state, preserving local Git state;
- session generation change: retry internally; never expose `SESSION_CHANGED`.

## Non-negotiable invariants

- No server table or API represents an installed computer or local checkout.
- No Cloud UI authorization is derived from a Git credential or URL alone.
- No Git RuntimeGrant is derived from a human JWT alone.
- No Project-root repository is represented as a synthetic Scope.
- No raw credential is persisted in application data or returned by list/read.
- No arbitrary or legacy Git remote identifies Cloud UI context.
