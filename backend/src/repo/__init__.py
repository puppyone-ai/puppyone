"""Repository surface module — scopes, connectors, identity, permissions.

The repository surface is split into four orthogonal sub-modules:

    scope_*       — repo_scopes subtree geometry CRUD (credentials are access-surface credentials)
    identity_*    — project URL + prompt_template (the "access point")
    connector_*   — compatibility facade over access_surfaces + connections

Git smart-HTTP and Puppyone CLI entry points both read repo_scopes as the
canonical scope identity table.
"""
