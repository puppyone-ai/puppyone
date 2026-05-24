# Version Engine Future Work

These are future improvements on top of the current Git-native architecture.
They are not compatibility fallbacks.

## Search And Indexing

- Keep path/metadata/content indexes derived from accepted write events.
- Rebuild indexes from committed Git trees when needed.
- Keep indexing out of the write request path.

## Shadow Snapshots

- Let local clients optionally publish private working-tree manifests.
- Keep shadow snapshots non-authoritative.
- Promote to committed content only through the Version Engine.

## Physical Database Rename

Some physical table/RPC names still come from the old schema and are isolated in
`backend/src/version_engine/server/db_names.py`. A future migration may rename
them, but runtime code must continue to reference them only through that file
until the database cutover happens.
