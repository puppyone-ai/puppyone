"""PuppyOne's Git-native Version Engine.

The Version Engine turns Product writes, AP-FS/CLI commands, Git pushes,
connector imports, and agent write-back into Git-compatible version facts
plus PuppyOne collaboration facts: scope policy, conflict state, audit,
history, and durable derived-work events.

The package layout mirrors the write architecture:

  domain/          Shared intents, conflict records, and errors.
  entrypoints/     L1 protocol surfaces: HTTP and Git smart HTTP.
  admission/       L2 identity plus L3 permission/target admission.
  adapters/        L4 request-to-intent adapters for product, Git, and batch.
  write_engine/    L5 write authority and Git object/tree/merge primitives.
  derived/         L6 hooks, outbox, projection, indexes, repair, and GC.
  read/            Read models and read-side helpers outside the write path.
  infrastructure/  Supabase, S3, and Git transport-cache implementations.
  bootstrap/       App/worker containers and FastAPI dependency factories.
"""
