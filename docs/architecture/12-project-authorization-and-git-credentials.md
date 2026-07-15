# Project Authorization and Git Credentials

PuppyOne has two independent authorization planes. Human product actions use a
current `ProjectGrant`; machine data-plane actions use a bounded
`RuntimeGrant`. A Git remote only locates a target and grants nothing.

## Ownership and authority

```text
Organization
└── Project
    ├── project_members ------------ explicit human role facts
    ├── ProjectGrant --------------- current control-plane decision
    ├── Canonical Git Repository
    │   ├── Project root
    │   └── repository_scopes ------ optional non-empty path restrictions
    └── access_surfaces
        └── access_surface_credentials
            └── RuntimeGrant ------- data-plane decision
```

`project_members` is the sole explicit Project role source. Organization
membership provides tenant context; organization-visible Projects provide at
most the documented Viewer baseline. Child-resource rules may narrow a grant
but never create or widen Project access.

## ProjectGrant

All Project-scoped HTTP routes use
`platform.authorization.AuthorizationService` with a named `ProjectAction`.
The result is recomputed from current facts and registered in the route
authorization manifest.

Examples:

- reading Project content requires `content.read`;
- writing content requires `content.write`;
- issuing a Git credential requires current access to its Project target;
- revoking a user-owned credential requires current Project access and exact
  credential ownership;
- Team, Billing, membership, and settings remain human control-plane actions.

Project IDs, Scope IDs, Git locators, Runtime keys, ownership hints, and local
paths never create a ProjectGrant.

## RuntimeGrant

A machine entry point resolves an explicit target and capability ceiling:

```text
RuntimeGrant = {
  principal,
  project_id,
  target: ProjectRootTarget | ScopeTarget,
  path_prefix,
  excludes,
  effective_mode,
  policy
}
```

For user Git credentials the current Project role is checked on every credential
resolution. Membership removal denies immediately. Downgrading an Editor to a
Viewer caps existing credentials to read-only. Scope geometry and Surface policy
may reduce the mode further.

RuntimeGrant is intentionally unable to call human control-plane APIs. This is
the privilege firewall between cloned Git clients and organization management.

## Desktop Project context

Desktop does not persist Cloud identity for a local folder. It derives ephemeral
context from the actual canonical PuppyOne remote:

```text
canonical remote
  -> local parser extracts exact RepositoryTarget
  -> current JWT authorizes target Project
  -> backend validates exact Scope, if present
  -> secret-free Project context
```

The context endpoint accepts only the structured target. It does not accept raw
remote URLs or any device/folder/workspace identifier. Without a canonical
remote the workspace is local-only and no context request is sent.

## Credential lifecycle

User Git credentials are ordinary independently revocable credentials, similar
to scoped personal access tokens:

- plaintext is shown exactly once;
- only a keyed hash is stored;
- each credential has one user owner, one Project, one Access Surface, and one
  maximum mode;
- many credentials may coexist for different clients;
- revocation addresses the credential ID and owner, not a local folder;
- credential reads never recover plaintext;
- shared service keys and expiring session keys remain separate lifecycles.

Local Git remote removal and server credential revocation are separate actions.
This avoids making the server infer a computer inventory from normal Git use.

## Database constraints

`access_surface_credentials.user_id` is required for the `user` lifecycle and
must reference an organization member. A user credential must be a Git HTTP
credential. Shared and session credentials have no user owner; session
credentials require an expiry. Every credential must match its Project,
Organization, Access Surface, target, type, and mode constraints.

The schema intentionally has no table or foreign key for local checkout
identity.

## Required audit fields

Credential issue/revoke and Runtime authorization decisions record redacted
principal reference, Project, exact target, mode, credential type, outcome, and
reason. Never record raw JWTs, credentials, local paths, repository content, or
computer identifiers.
