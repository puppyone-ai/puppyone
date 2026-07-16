# Project Publish Control Plane

This document defines how a local Git repository becomes a hosted PuppyOne
Project without changing the Version Engine architecture. Project publication
is split between a transactional control plane and the existing Git-native data
plane.

## Layering

```text
Organization                         tenant, membership, billing, quota
└── Project                          ownership and human authorization
    ├── Publish control-plane facts  idempotency and deletion lifecycle
    ├── Git Access Surface           credential and RuntimeGrant boundary
    └── Canonical Repository         frozen Version Engine authority
        ├── Project-root view        /git/{project_id}.git
        └── optional Scope views     /git/{project_id}/scopes/{scope_id}.git
```

The control plane may create, authorize, tombstone, and schedule cleanup for a
Project. Only the Version Engine admits Git content, publishes refs and root
state, records version history/audit, and owns object storage semantics.

## Idempotent Project admission

Desktop Project creation requires an explicit `org_id` and a canonical UUID v4
`Idempotency-Key`. The durable namespace is:

```text
(authenticated_user_id, operation_kind, idempotency_key)
```

The canonical payload includes all resolved defaults. Within one database
transaction the server:

1. serializes contenders for the key;
2. returns a same-payload replay before evaluating quota;
3. rejects a different payload for the same key;
4. rejects replay when the original Project is tombstoned;
5. verifies current membership in the explicit Organization;
6. serializes Organization quota admission;
7. creates the Project and initial Admin grant;
8. records the canonical empty repository root defined by the frozen Version
   Engine contract; and
9. persists the replay outcome.

This ordering prevents both duplicate Projects after response loss and quota
oversubscription under concurrent creates. It does not create Git commits or
simulate a Push.

Template provisioning remains a separate, explicitly recoverable workflow. A
plain Desktop publish cannot silently switch to a template/seed path.

## Operation credential

Credential issuance uses the same client operation UUID in its own endpoint
namespace. Electron main supplies a high-entropy secret over TLS; the service
stores only its keyed hash and redacted hints. Same key and same canonical
payload replay the same credential identity. Key reuse with a different target,
mode, or secret hash fails closed.

The credential is a normal exact-target Git runtime principal. It is not a
checkout Binding and carries no device, path, worktree, or client identity.
Current Project membership and role still cap its effective `RuntimeGrant` on
every Git request.

## First Push

The newly created Project is Git-visible as empty. Desktop pushes an immutable
local commit SHA through the existing canonical Project-root smart-HTTP route.
All receive-pack policy, quarantine, CAS, root publication, audit, history, and
derived follow-up remain unchanged inside the Version Engine.

Control-plane success never implies content success. After an uncertain
transport response, Desktop compares the canonical remote ref with the expected
SHA. Only the Version Engine's accepted ref establishes that the Project has
been published.

## Abandon and deletion

Initialization Abandon is limited to the actor and operation that created the
Project. It is allowed only while the canonical repository remains empty and no
accepted root Push/head exists. In one control-plane transaction it revokes the
operation credential, tombstones the idempotency outcome, cuts off Project
access, and creates or reuses a durable deletion job.

Ordinary Project deletion uses the same lifecycle. Object-prefix and derived
resource cleanup is asynchronous, idempotent, audited, and retryable. The job
survives Project-row deletion and invokes existing storage interfaces from
outside `backend/src/version_engine/`; it does not teach the Version Engine
about Desktop operations.

## Stable failure contract

| Condition | Result |
|---|---|
| missing idempotency key | typed 400 |
| malformed key | typed 422 |
| missing explicit Organization | typed 422 |
| same key, same payload | stable replay |
| same key, different payload | typed 409 |
| original target tombstoned | typed 410 |
| concurrent quota exhausted | typed quota rejection, no partial Project |
| accepted content exists during Abandon | typed 409, no deletion |

Internal database exceptions and session-generation messages are never product
copy.

## Frozen Version Engine boundary

This control-plane feature must not modify:

- repository target geometry or root/Scope semantics;
- Git smart-HTTP protocol behavior;
- receive-pack policy, quarantine, or merge/conflict rules;
- CAS/root/ref/history/audit publication;
- object layout, storage abstraction, or GC semantics; or
- human `ProjectGrant` versus machine `RuntimeGrant` separation.

Cross-layer tests may exercise those public contracts. The implementation diff
must contain no source changes under `backend/src/version_engine/`.
