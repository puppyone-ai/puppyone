# Connectors

Connectors are second-level adapters under a product service. They can move
external data, expose a scoped filesystem protocol, or run a workspace runtime,
but they do not own product lifecycle or version semantics.

## Rule

Connectors produce capabilities and typed content intents for their owning
service. They do not publish refs directly and do not implement their own
conflict semantics.

```text
Product service
  (Upload / Import / Integration / Access)
        |
        v
Connector
  (data provider / filesystem / AI-runtime / sandbox adapter)
        |
        v
ProductOperationAdapter or version submission intent
        |
        v
VersionWriteEngine
```

Connector is an implementation capability, not a product entry point. The
product entry points are Upload, Import, Integration, and Access. A connector
may be used by one or more services, but it must not decide which product flow
is being executed.

Examples:

- Import service may use a GitHub, URL, Notion, or template connector once.
- Integration service may use GitHub, Google Drive, Gmail, database, or local
  filesystem connectors over time.
- Access service may use Git, CLI/AP-FS, Sandbox, or AI-runtime connectors to
  expose a scoped workspace surface.

Agent features may run through Sandbox or other Access connectors, but Agent is
not a fifth entry point and should not be modeled as a product flow.

## Responsibilities

- Fetch external resources.
- Expose scoped workspace protocols or runtimes for Access.
- Normalize files and metadata.
- Stage uploaded bytes as Git-compatible blob objects.
- Submit writes with a source channel for audit.
- Let the Version Engine decide CAS, merge, conflict, audit, and outbox.

## Non-Goals

- No connector-specific version protocol.
- No connector-specific history table.
- No connector-side last-writer-wins outside the Version Engine.
