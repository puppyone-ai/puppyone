# Canonical Git Remote Rollout Runbook

Status: **required for rollout; legacy removal is not authorized by this runbook**

The normative protocol contract is
[Git Remote Locator, Credential, And Access Point Contract](../architecture/05-git-remote-accesspoint.md).
This runbook owns deployment order, database assertions, canaries, telemetry,
rollback, and the eventual legacy-removal gate. It does not redefine Version
Engine behavior.

## Non-negotiable invariants

1. Version Engine L3-L6 stays authoritative and unchanged:
   `RepoFacade -> GitViewHead/cache -> stock Git -> quarantine ->
   VersionSubmissionIntent -> canonical-root CAS/audit/outbox`.
2. A URL identifies one Project root or one exact Scope; it grants nothing.
3. A Git secret appears only in HTTP authorization/credential-helper input. It
   never appears in a URL, manifest, command argument, image, or access log.
4. Root URLs accept only root-Scope credentials. Scoped URLs require exact
   Project and Scope equality.
5. Shared `r`, shared `rw`, per-binding, and short-lived session credentials
   are separate rotation domains.
6. `/git/ap/<key>.git` remains a no-redirect compatibility adapter until a
   separate approved breaking change removes it.

## Release units and order

```text
A. database expand migration
   20260713020000_canonical_git_remote_contract.sql
           |
           v
B. backend L1/L2 dual-route support
   canonical locator parser + one runtime-credential resolver
           |
           v
C. issuers and first-party consumers
   Web -> Desktop -> Sandbox/internal jobs -> user/CLI guidance
           |
           v
D. observation window
   canaries + mismatch checks + redacted legacy counter
           |
           v
E. separately approved contract/removal release
```

Never deploy a canonical-only client before A and B are healthy. Never remove
the compatibility route as part of A-D.

## Phase 0: preflight

- Confirm the hosted `ACCESS_CREDENTIAL_HASH_SECRET` is present and stable.
  Changing it invalidates every hash-only credential.
- Confirm the normal database backup/recovery point required by
  [Database Release Governance](../architecture/13-database-release-governance.md).
- Validate the OpenSpec change and repository tests listed below.
- Inventory deployed Desktop versions and worker/Sandbox images that may still
  construct `/git/ap/` URLs.
- Confirm custom proxy and Uvicorn access logs either use the application
  middleware's redacted path or independently redact the legacy path segment.

## Phase 1: database expand

Apply the migration through the governed Supabase migration pipeline. The
migration is transactional and additive:

- adds and backfills `access_surface_credentials.grant_mode` and the explicit
  `credential_lifecycle` revocation domain;
- validates credential/surface/scope/binding integrity on writes;
- adds independent shared Git rotation, binding issue/rotation, and a single
  `resolve_git_runtime_credential` RPC;
- leaves the legacy CLI/bearer RPC signatures intact.

Run these read-only assertions immediately after apply:

```sql
-- Must be zero.
select count(*) as invalid_grant_mode
from public.access_surface_credentials
where grant_mode is null or grant_mode not in ('r', 'rw');

-- Must be zero: lifecycle class and binding/expiry shape are explicit.
select count(*) as invalid_credential_lifecycle
from public.access_surface_credentials
where credential_lifecycle not in ('shared', 'session', 'binding')
   or credential_lifecycle is null
   or (credential_lifecycle = 'binding' and workspace_binding_id is null)
   or (credential_lifecycle <> 'binding' and workspace_binding_id is not null)
   or (credential_lifecycle = 'session' and expires_at is null);

-- Must be zero: active Git tokens may only hang from active Git surfaces.
select count(*) as invalid_git_surface
from public.access_surface_credentials c
left join public.access_surfaces s on s.id = c.access_surface_id
where c.status = 'active'
  and c.credential_type = 'git_http_token'
  and (
    s.id is null
    or s.kind <> 'git_remote'
    or s.status <> 'active'
    or s.project_id <> c.project_id
    or s.org_id <> c.org_id
  );

-- Must be zero: every Git surface must resolve one Scope in the same Project.
select count(*) as invalid_git_scope
from public.access_surfaces s
left join public.repo_scopes rs
  on rs.id = s.scope_id and rs.project_id = s.project_id
where s.kind = 'git_remote' and rs.id is null;

-- Must be zero: active binding credentials must match an active binding.
select count(*) as invalid_binding_credential
from public.access_surface_credentials c
left join public.project_workspace_bindings b
  on b.id = c.workspace_binding_id
left join public.access_surfaces s
  on s.id = c.access_surface_id
where c.status = 'active'
  and c.workspace_binding_id is not null
  and (
    b.id is null
    or b.status <> 'active'
    or b.project_id <> c.project_id
    or b.org_id <> c.org_id
    or b.scope_id <> s.scope_id
  );
```

Do not print `key_hash`, raw historical access keys, provider config, or full
request URLs while diagnosing a failure.

## Phase 2: backend dual-route canary

Deploy B with both route families enabled. Recycle every backend worker; a
long-lived Python process retains the pre-deploy row mapper even when source
files on disk have changed. Before testing Desktop attachment, verify that
`GET /api/v1/projects/{project_id}/scopes` succeeds against a schema where the
retired `repo_scopes.access_key` column is absent and returns no plaintext key.

Then verify:

| Canary | Expected result |
| --- | --- |
| Root URL + root `r` token | clone/fetch succeeds; push is rejected |
| Root URL + root `rw` token | clone/fetch/push succeeds |
| Root URL + non-root token | uniform `401` before repo/cache access |
| Scoped URL + exact scoped token | projected clone/fetch/push behavior |
| Scoped URL + sibling Project/Scope token | uniform `401` |
| Revoked/expired/disabled/binding-downgraded token | uniform `401` or narrowed `r` |
| Missing/malformed auth | `401` plus `WWW-Authenticate: Basic` |
| Legacy URL | same RepoFacade/content result; no redirect |
| Human JWT sent to `/git/.../health` | uniform `401`; JWT is not a Git credential |
| Project Read JWT sent to `/api/v1/projects/{id}/git-view/health` | root health loads; `can_rebuild` reflects current ProjectGrant |
| Non-Admin/Admin cache rebuild through Project API | `403` / both root cache variants rebuilt |

Use stock Git plus a temporary path-aware credential helper, as exercised by
`backend/tests/version_engine/test_write_engine.py`. Never paste a token into a
clone URL or command line.

For one root and one non-root canary, compare canonical versus compatibility
facts:

- RepoFacade path, excludes, and effective mode;
- Git-visible head and cache identity;
- accepted canonical root and source-Scope CAS results;
- `source_channel=access_git`, audit semantics, and outbox readiness;
- root readiness changes only after a root accepted push.

## Phase 3: first-party conversion

### Web

- Display only canonical root/scoped URLs.
- Issue/rotate the one-time Git password separately.
- Label the existing bearer token as a CLI key, not a Git key.
- Verify Scope create/regenerate reveals a `cli_...` key exactly once, while
  Scope PATCH/list, Repo Identity, and dashboard lists return no plaintext.
- Never build a runnable CLI prompt from a masked hint or `<access-key>`
  placeholder; require explicit generation and keep the result in page memory.
- Allow explicit `r` or `rw` issuance without letting either exceed Scope mode.
- Read root Git-view health through the Project control plane with the human
  JWT; never call `/git/.../health` or `/git/.../rebuild-cache` with that JWT.

### Desktop

- A verified existing Workspace Binding opens its exact Project directly;
  Organization Project enumeration is not a prerequisite.
- During session restore, verify that the exact binding and Project requests
  complete without an earlier Organization Project-catalog request; catalog
  loading remains available only for explicit unbound browsing.
- Treat an unbound locator only as a candidate requiring current JWT
  authorization and explicit binding confirmation.
- Store only stable binding identity in the manifest.
- Approve the secret through an OS-backed, path-aware Git credential helper.
- Configure, run `git ls-remote`, and only then delete a legacy secret URL.
- On failure, restore the previous remote and manifest and revoke a newly
  created binding; when an existing binding was reused, revoke only the newly
  rotated credential so a failed local setup never leaves an unreported live
  secret or destroys durable binding identity.

### Sandbox and workers

- Issue an expiring, non-disruptive Git session token.
- Deliver it in a mode-0600 ephemeral credential-helper file.
- Renew before expiry and atomically replace the helper file.
- Never bake the token into an image, environment dump, URL, or process args.

### Static construction scan

Before promotion, `/git/ap/` may remain only in the backend compatibility
router, explicit legacy parser/health support, migration tests, and historical
documents. New URL constructors fail the release gate.

```bash
rg -n '/git/ap/' backend/src frontend cli sandbox packages
rg -n '/git/ap/' '/path/to/puppyone desktop/local-api' '/path/to/puppyone desktop/src'
rg -n 'credential\.helper store|https?://[^ ]+:[^ ]+@' backend frontend cli sandbox
```

Review every match; do not use a blind zero-match rule because the bounded
compatibility adapter is deliberate.

## Telemetry and release gates

The application access-log context rewrites a legacy path to
`/git/ap/<redacted>.git/...`. A successfully resolved compatibility request
emits `[GitLegacy]` with `route`, `outcome`, and one-way Project/Scope refs only.
The event must never include the key, raw path, user ID, Project ID, Scope ID,
scope path, Authorization header, or credential-helper payload.

Track at least:

- canonical root/scoped request count and outcome by operation;
- uniform-auth failure rate (without reason/target labels exposed to clients);
- legacy accepted-request count;
- credential issue/rotate/revoke success and compensation failure;
- Git view rebuild/corruption and receive-pack rejection rates;
- Workspace Binding direct-open success versus explicit recovery;
- Sandbox credential renewal failures.

Promotion gates:

| Gate | Requirement |
| --- | --- |
| G0 schema | migration replayed in a disposable DB; all four assertions are zero |
| G1 backend | route/auth, real-Git, equivalence, security, and architecture tests pass |
| G2 clients | Web type/build and Desktop type/integration tests pass; no new key URL constructor |
| G3 canary | root and scoped clone/fetch/push pass with expected audit/readiness facts |
| G4 observation | no target-mismatch or secret-log incident during the agreed window |
| G5 retirement | supported first-party versions emit zero legacy use for the agreed window |

G5 permits drafting a removal proposal; it does not itself remove the route.

## Rollback and incident response

| Failure point | Safe action |
| --- | --- |
| Migration transaction fails | PostgreSQL rolls back the transaction; investigate before retry |
| Backend fails before client rollout | roll back the service binary; leave additive schema/RPCs in place |
| Backend fails after canonical credentials were issued | keep canonical ingress; disable affected issuance UI if needed and repair forward |
| Web/Desktop release fails | roll back that client only; dual-route backend remains |
| Local bind/configure fails | restore prior manifest/remote, reject local helper entry, revoke newly created binding when applicable |
| Credential suspected exposed | rotate only its shared mode slot, binding, or session; URL and Git-view cache stay unchanged |
| Sandbox renewal fails | stop new Git work, revoke/expire the session token, retain canonical URL and canonical server facts |
| Derived Git cache fails | rebuild from committed Version Engine facts; never promote cache state to authority |

After clients rely on canonical-only credentials, rolling the backend back to a
legacy-only release is unsafe. The compatibility route is for old clients; it
cannot authenticate a new Git HTTP token by embedding it into a URL.

## Required verification commands

Run from the repository roots using the checked-in environments:

```bash
# Backend contracts, security, real Git, and Version Engine equivalence
backend/.venv/bin/pytest backend/tests/security \
  backend/tests/platform/test_workspace_binding_service.py \
  backend/tests/platform/scope_sandbox \
  backend/tests/version_engine/test_git_canonical_auth.py \
  backend/tests/version_engine/test_git_channel_pause.py \
  backend/tests/version_engine/test_write_engine.py

# Database: disposable/local instance only; never reset a hosted database
supabase db reset
supabase test db

# Web
cd frontend && ./node_modules/.bin/tsc --noEmit && npm run build

# CLI
cd cli && npm run test:unit

# Desktop (from the separate `puppyone desktop` repository)
npm test -- --reporter=dot
npm run check:boundaries
npx tsc --noEmit

# OpenSpec
cd backend && openspec validate refactor-canonical-git-remote-contract --strict
```

Desktop runs its TypeScript checker plus the Cloud Hub, binding resolver,
credential-helper, and real workspace Git integration tests. Also run
`git diff --check` and verify the implementation diff touches Version Engine
entrypoint/admission integration only, not L3-L6 transaction semantics.

## Legacy removal is a separate change

The future removal proposal must include:

1. exact supported-client/version floor;
2. measured zero-use window and telemetry query;
3. configuration scan evidence;
4. customer migration and recovery path;
5. proxy/access-log confirmation;
6. rollback that does not reintroduce key-bearing URL issuance;
7. deletion of the compatibility resolver, tests, and redaction only after the
   route can no longer receive traffic.

Until that proposal is separately approved and deployed, the compatibility
route and its redaction tests stay in place.
