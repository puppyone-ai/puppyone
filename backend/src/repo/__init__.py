"""Repository surface module — scopes, connectors, identity, permissions.

The repository surface is split into four orthogonal sub-modules:

    scope_*       — repo_scopes table CRUD (subtree definitions + per-scope keys)
    identity_*    — project URL + prompt_template (the "access point")
    connector_*   — connectors table CRUD (data flow channels bound to a scope)
    permission_*  — repo_user_permissions table (team plans only)

Git smart-HTTP and Puppyone CLI entry points both read repo_scopes as the
canonical scope identity table.
"""
