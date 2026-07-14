## ADDED Requirements

### Requirement: Single commercial rule authority

The hosted system MUST use the versioned PuppyPay catalog as the only executable source of plan
prices, seat ranges, included storage, and included runtime units. Client and PuppyOne product code
MUST NOT create orders from local price constants.

#### Scenario: Desktop displays a plan

- **WHEN** an authenticated Desktop loads Billing
- **THEN** it receives a sanitized catalog through the PuppyOne BFF
- **AND** the response contains no provider secret or internal product mapping

#### Scenario: Catalog is unavailable

- **WHEN** the catalog cannot be obtained or validated
- **THEN** the client displays an unavailable/retry state
- **AND** it does not fall back to a stale price

### Requirement: Authenticated billing BFF

PuppyOne MUST expose the supported billing read and mutation operations through an authenticated
BFF. Every organization mutation MUST re-evaluate billing-manager authorization and use a stable
idempotency key.

#### Scenario: Non-owner attempts checkout

- **WHEN** an organization member without billing-manager authority requests checkout
- **THEN** PuppyOne denies the request before contacting PuppyPay

#### Scenario: Mutation is retried

- **WHEN** the same mutation and idempotency key are retried
- **THEN** the system returns the original semantic result without creating a second charge or
  subscription mutation

### Requirement: Open-source deployment independence

Community `disabled` and `local` deployments MUST boot and operate without PuppyPay or official
Polar credentials. Hosted required mode MUST fail startup when its billing dependencies are
incomplete or contradictory.

#### Scenario: Community self-host starts

- **WHEN** `ENTITLEMENTS_MODE=disabled` and billing enforcement is disabled
- **THEN** PuppyOne starts without contacting PuppyPay

#### Scenario: Hosted required mode lacks a service credential

- **WHEN** hosted billing is required but the PuppyPay service credential is absent
- **THEN** startup fails with a non-secret configuration error

### Requirement: Provider lifecycle is authoritative

A checkout return URL MUST NOT activate paid access. Only verified provider lifecycle processing,
PuppyPay commercial state, and an accepted entitlement revision may change hosted access.

#### Scenario: User returns before webhook processing

- **WHEN** the browser returns from checkout before the provider event is processed
- **THEN** Desktop displays a pending state
- **AND** paid features remain unchanged until the entitlement revision is accepted
