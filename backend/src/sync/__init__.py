"""
Sync Module — Unified sync architecture

PuppyOne is the Hub; all external systems are Spokes.
N adapters, not N×N.

Data model:
  syncs  — Unified table. Each row represents one sync binding between
           a content_node and an external resource, carrying both
           connection config and per-node sync state.

Triggers:
  filesystem  → watchdog (FSEvent, real-time)
  SaaS        → polling / webhook (per adapter type)

Sync directions:
  bidirectional  — Changes sync both ways
  inbound        — External is source of truth, PuppyOne read-only
  outbound       — PuppyOne is source of truth, external read-only
"""
