"""
L2.5: Sync Service — Bidirectional background sync

PuppyOne is the Hub; all external systems are Spokes.
N adapters, not N×N.

Data model:
  sync_sources   — External data source connections (a directory / repo / workspace)
  content_nodes  — Sync state lives directly on each node
                   (sync_source_id, external_resource_id, remote_hash, last_sync_version)

Triggers:
  filesystem  → watchdog (FSEvent, real-time)
  SaaS        → polling / webhook (per adapter type)

Sync modes:
  bidirectional  — Changes sync both ways
  pull_only      — External is source of truth, PuppyOne read-only
  push_only      — PuppyOne is source of truth, external read-only
"""
