"""Repo redesign module — scopes, connectors, repo identity, per-user permissions.

This module replaces the old `connectors/manager/` unified-CRUD approach.
Per the access-point redesign (docs/design/access-point-redesign-2026-05-02.md),
the surface is split into four orthogonal sub-modules:

    scope_*       — repo_scopes table CRUD (subtree definitions + per-scope keys)
    identity_*    — project URL + prompt_template (the "access point")
    connector_*   — connectors table CRUD (data flow channels bound to a scope)
    permission_*  — repo_user_permissions table (team plans only)

The mut wire protocol is unchanged. The mut adapter
(backend/src/mut_engine/server/backends/supabase_scope.py) reads from
repo_scopes instead of access_points.config.scope.
"""
