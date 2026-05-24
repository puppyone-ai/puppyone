# Gateway And Access Boundary

PuppyOne keeps control-plane identity separate from version-plane access.

## Boundaries

- JWT-authenticated Web/API calls operate as product users.
- Access-key Git Remote and AP-FS calls operate through scoped Access Points.
- Gateways and connectors may create intents, but the Version Engine publishes.

## Access Enforcement

Every write path checks:

- project membership or access-key validity,
- channel pause,
- scope path,
- excludes,
- read/write mode,
- optional identity binding,
- current base/head precondition.

There is no bypass path that can write versioned content outside
`VersionWriteEngine`.
