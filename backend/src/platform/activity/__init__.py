"""Context activity — read-only aggregation of upload / import / sync_run history.

This package exposes the ``context_activity_items`` DB view (defined in
migration 20260602010000) as a single read-only endpoint. The view UNIONs
``upload_jobs``, ``import_jobs`` and ``sync_runs`` into one shape so the
frontend Activity surface can show all three context-entry-point flows
together — WITHOUT collapsing them into one write model. This package never
writes; each entry point keeps its own table and lifecycle.
"""
