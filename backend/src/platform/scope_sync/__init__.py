"""Scope-sandbox sync engine (PUP-sync-trigger-architecture-2026-06).

Two-speed sync over the sandbox working tree: cheap private *checkpoints* (the
"change" lane, reusing shadow snapshots) vs deliberate *publishes* (the
"version" lane → source of truth). Managed triggers (per persona) decide which,
and an upstream channel integrates others' changes lazily + path-scoped.

This package is layered like ``scope_sandbox``:
  - ``policy``   pure decision logic (no I/O) — the brain.
  - (later) ports + coordinator + checkpoint store + publish pipeline.
"""
