## 1. Contract and schema

- [x] 1.1 Freeze/export PuppyPay public and internal contracts and hosted provider-map guardrails.
- [x] 1.2 Add PuppyOne entitlement, billing operation, runtime run, and usage
      counter migrations with RLS/indexes.
- [x] 1.3 Add migration and database concurrency tests.

## 2. PuppyOne billing and entitlement

- [x] 2.1 Implement Gateway configuration, HTTP adapter, disabled adapter, and stable errors.
- [x] 2.2 Implement authenticated/authorized Billing BFF routes and idempotency propagation.
- [x] 2.3 Implement complete snapshot validation and monotonic repository publication.
- [x] 2.4 Remove hosted fallback merging and preserve self-hosted disabled/local behavior.

## 3. Product execution

- [x] 3.1 Implement billable-seat policy and durable seat operation orchestration.
- [x] 3.2 Gate member activation and seat-affecting changes through the seat saga.
- [x] 3.3 Implement durable runtime reserve/heartbeat/settle orchestration and recovery.
- [x] 3.4 Hook every hosted compute path or explicitly mark unsupported paths fail-closed.
- [x] 3.5 Implement logical storage counters, quota checks, threshold state, and reconciliation.

## 4. Desktop and legacy surfaces

- [x] 4.1 Add typed Desktop Billing BFF clients.
- [x] 4.2 Replace hard-coded plan cards with catalog/summary/usage state.
- [x] 4.3 Add seat quote, checkout, portal, pending refresh, and system-browser flow.
- [x] 4.4 Add feature flags, failure states, and tests; disable stale Web purchase behavior.

## 5. Verification and rollout

- [x] 5.1 Add contract, unit, database integration, and cross-service tests.
- [x] 5.2 Add metrics, reconciliation, migration/rollback runbooks, and failure drills.
- [x] 5.3 Run PuppyPay, PuppyOne, Desktop, OpenSpec, migration, and issue audit quality gates.
- [x] 5.4 Review the final implementation for duplicated policy, permissive fallback, secret
      exposure, non-idempotent writes, and missing execution entry points.
