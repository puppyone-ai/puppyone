# Connectors

Connectors move external data into or out of the Version Engine without owning
version semantics.

## Rule

Connectors produce typed content intents. They do not publish refs directly and
do not implement their own conflict semantics.

```text
SaaS / database / ingest / agent / sandbox connector
        |
        v
ProductOperationAdapter or version submission intent
        |
        v
VersionWriteEngine
```

## Responsibilities

- Fetch external resources.
- Normalize files and metadata.
- Stage uploaded bytes as Git-compatible blob objects.
- Submit writes with a source channel for audit.
- Let the Version Engine decide CAS, merge, conflict, audit, and outbox.

## Non-Goals

- No connector-specific version protocol.
- No connector-specific history table.
- No connector-side last-writer-wins outside the Version Engine.
