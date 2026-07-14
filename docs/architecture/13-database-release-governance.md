# Database Release Governance

PuppyOne uses Supabase's official schema history and a portable extension for
online production-data transformations. GitHub Actions is an adapter, not the
migration engine.

## One rule, two lanes

```text
Schema lane
supabase/migrations -> supabase db push -> supabase_migrations.schema_migrations

Data lane
supabase/data_migrations -> puppyone-db -> public.migration_log
```

Use `supabase/migrations` for DDL and small pure-SQL changes that are bounded,
transactional, and need no pause, application secret, runtime code, or external
service. Use `supabase/data_migrations` for everything that needs batching,
retry/resume, Python, an application HMAC secret, S3/API access, or a release
boundary between Expand and Contract.

`supabase/seed.sql` is only bootstrap/demo/test data. It is not a production
upgrade mechanism.

## Repository structure

```text
supabase/
├── migrations/                 # official Supabase schema history
├── data_migrations/            # immutable PuppyOne data artifacts
│   ├── manifest.schema.json
│   ├── schema_history_baseline.json # immutable pre-governance hashes
│   └── <migration_id>/
│       ├── manifest.yml
│       ├── run.sql | run.py
│       ├── verify.sql
│       └── contract.pending.sql # optional reviewed future contract
├── tests/
└── seed.sql

backend/src/infra/data_migrations/  # portable CLI and runner
.github/workflows/                  # thin hosted adapters
```

The manifest chooses only `sql` or `python` and one file in its directory. It
does not contain an arbitrary shell command. Its checksum covers the normalized
manifest, entrypoint, and verification SQL.

SQL artifacts contain SQL only. The runner rejects transaction control, every
psql meta-command, and `COPY ... PROGRAM`; the runner owns the transaction,
connection, lock, verification, and receipt boundary.

Standalone `verify` operations run in a read-only PostgreSQL transaction with
both client and server timeouts. During an SQL data migration, entrypoint,
verification, and receipt remain one atomic transaction so a failed
postcondition rolls back the transformation.

Python child processes receive only the environment variables declared by the
manifest plus a small runtime/CA/proxy allowlist. They do not inherit the
database URL, GitHub token, or an ambient `PYTHONPATH`. They run in Python
isolated mode from the artifact directory. Python artifacts are single-file
jobs and cannot import PuppyOne's mutable `src` application package or sibling
helpers outside the checksum; third-party packages come from the repository's
locked runtime.

## Release state machine

```text
Expand -> Data -> Cutover -> Contract
```

1. Expand adds compatible schema. The running application can tolerate old and
   new rows.
2. Data copies/transforms old facts. Qubits runs first; Production runs only
   after Qubits verification.
3. Cutover makes the application read/write only the new fact and waits for old
   instances to drain.
4. Contract removes the old schema in a later PR. SQL fails closed unless the
   receipt checksum and actual row-level postcondition both pass.

Do not put Expand and Contract in the same release. A fresh install with zero
legacy rows may apply the final Contract without running irrelevant historical
data jobs.

An identity-representation cutover may intentionally use one atomic Contract
without a dual-write phase only when both representations cannot safely coexist
and all of the following stricter gates hold: a read-only immutable preflight,
exact checksum receipt, mutation freeze, database restore point, one-transaction
mapping, previous-schema upgrade fixture, dirty-data rejection proving no
receipt/no mutation, credential-ID/hash continuity, and same-SHA application
deployment. ISSUE-039 is this narrow case: keeping both a synthetic root Scope
and Project-root identity would preserve the ambiguity the change removes. This
exception does not permit ordinary feature Expand and Contract work to be
collapsed.

## Operator commands

From `backend/`:

```bash
uv run puppyone-db lint
uv run puppyone-db list
DATA_MIGRATION_DATABASE_URL='postgresql://...' \
  uv run puppyone-db plan <migration_id>
DATA_MIGRATION_DATABASE_URL='postgresql://...' \
  uv run puppyone-db run <migration_id>
DATA_MIGRATION_DATABASE_URL='postgresql://...' \
  uv run puppyone-db verify <migration_id>
```

Hosted operators use the `Data Migration` GitHub workflow. `plan` and `verify`
are read-only. `run` mutates data and writes a receipt after verification.

The bundled GitHub adapter targets Supabase Cloud and therefore validates a
project ref against canonical direct/session-pooler hosts. Self-hosted PuppyOne
deployments use the same CLI/manifest contract from their own CI adapter and
may omit `SUPABASE_PROJECT_ID` when those canonical hosts do not exist.

The database URL MUST be a direct or session-pooler PostgreSQL URI that supports
session advisory locks. It is stored as an environment secret and passed to
libpq through `PGDATABASE`, never rendered in command arguments.

For hosted Supabase runs, the runner also proves that `SUPABASE_URL` and the
direct/session-pooler database URI belong to `SUPABASE_PROJECT_ID`. It refuses
an unprovable pairing so a legacy API backfill cannot mutate one project and
write its receipt to another.

## Receipt semantics

PuppyOne reuses `public.migration_log`:

- no row: incomplete or failed;
- row with matching artifact checksum: completed;
- row with a different checksum: immutable-history violation.

The JSON summary contains only checksum, source SHA, runner version, legacy
flag, and verification state. Never write credentials or user data into it.
GitHub/GitLab/Jenkins keeps detailed execution logs.

## CI/CD gates

Pull requests must pass:

- manifest/schema validation;
- immutable migration-file policy;
- unique 14-digit, timestamped snake_case schema filenames;
- no hidden Python/script instruction in new schema SQL;
- marked data dependency for destructive Contract SQL;
- an artifact checksum pinned in every destructive Contract;
- fresh database rebuild and pgTAP;
- legacy fixture -> data runner -> idempotent rerun -> Contract;
- corruption fixture -> failed preflight -> no receipt and no schema mutation;
- concurrent idempotent target enable and existing-credential continuity;
- targeted backend runner and authorization-boundary tests;
- no shared-database credentials in pull-request jobs.

The pull-request workflow always publishes one stable `Database validation
result` check. Non-database PRs finish after a read-only path check; database
PRs cannot publish success until every policy, rebuild, upgrade, and lint job
succeeds. This avoids the required-check deadlock caused by workflow-level
path filters.

Schema and data jobs for an environment share the same concurrency group and
cannot cancel a running database operation. Production uses a protected GitHub
Environment. A Production data `run` first verifies the same artifact checksum
and row-level postcondition against the Staging environment; failure prevents
Production execution.

For a normal `qubits -> main` release that changes schema, Main Release Gate
requires a successful Qubits schema deployment for the exact source SHA. A new
Contract additionally requires:

- successful staging `verify <migration_id>` on the Qubits head SHA;
- successful production `verify <migration_id>` on the current main/base SHA.

For non-owner releases, the owner's approval must also target the exact current
head SHA; a commit pushed after review invalidates the gate. Database hotfix
label changes re-run the same trusted metadata-only gate.

The Qubits schema workflow runs on every `qubits` push, including code-only
commits. This makes the exact-SHA requirement automatic instead of forcing a
manual re-run after the last non-database commit in a release.

When a data artifact contains `contract.pending.sql`, repository policy
requires the promoted Contract migration to be a byte-for-byte copy. Its
receipt checksum proves which data transformation ran; exact-copy enforcement
proves that reviewers approved the destructive SQL that is being promoted.

## Environment secrets

Create protected `staging` and `production` GitHub Environments. Store the same
generic names in each environment, with environment-specific values:

```text
SUPABASE_ACCESS_TOKEN
SUPABASE_PROJECT_ID
SUPABASE_DB_PASSWORD
DATABASE_URL
SUPABASE_SERVICE_ROLE_KEY
ACCESS_CREDENTIAL_HASH_SECRET
```

The reusable workflows read only these environment secrets; callers do not
inherit the repository's other secrets. Allow `qubits` and `main` to reference
`staging` (main performs the Production promotion check); allow only `main` to
reference `production`. Require reviewers for Production writes.

`DATABASE_URL` should prefer the Supabase session pooler on port `5432` when
direct IPv4 DNS is unavailable. Do not use transaction-pooler port `6543` for
jobs that hold session advisory locks.

## Upstream alignment

This extension preserves Supabase's documented contract: schema SQL stays in
[`supabase/migrations`](https://supabase.com/docs/guides/deployment/database-migrations),
`db reset` rebuilds from those files, and `db push` deploys unapplied versions.
Supabase also recommends CI/CD or Branching for staged deployment and warns
teams not to change remote schemas through the Dashboard once migration history
is in use. Seed files remain insertion-only bootstrap data, consistent with the
[Supabase seeding guide](https://supabase.com/docs/guides/local-development/seeding-your-database).

## Commit and PR convention

Branches:

```text
db/expand-<topic>
db/data-<topic>
db/cutover-<topic>
db/contract-<topic>
hotfix/db-<topic>
```

Commits:

```text
feat(db-expand): add project membership facts
chore(data-migration): backfill project memberships
refactor(db-cutover): read canonical project memberships
refactor(db-contract): remove legacy permission table
fix(db): add forward repair for membership constraint
```

One PR owns one phase. Applied/shared schema migrations and released data
artifacts are immutable. Fix mistakes with a new forward artifact.

At governance adoption, migrations already shared through Qubits are pinned in
`supabase/data_migrations/schema_history_baseline.json`. They may be promoted
unchanged to an older Production history even when they contain pre-governance
patterns; changing their bytes or the baseline fails policy. Files outside that
baseline follow all current rules immediately.

Every database PR states its phase, affected tables, compatibility window,
estimated rows/runtime/locks, migration ID, verification, retry behavior,
forward-fix plan, destructive operations, and Qubits evidence.

## Break glass

Remote SQL Editor writes and laptop-to-shared-database pushes are forbidden in
normal operation. An incident exception requires an incident record, reviewed
SQL in Git, recoverable backup/PITR, bounded transaction/timeouts, captured
output, and a follow-up forward migration. A database hotfix PR to `main`
requires the `database-break-glass` label.
