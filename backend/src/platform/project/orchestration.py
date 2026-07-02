"""Shared create-chain for born-owned projects.

`create_project` (router) and `landing.claim` both need the same three steps:
create the project row, initialize its version tree, and ensure the canonical
root scope exists. They differ only in which version-engine container / admin
instance they hold and in what extra content, scopes, or endpoints they layer
on afterwards — so the admin service is injected and the per-caller extras stay
at the call site.

The demo-seed path (``auth/initialization``) is intentionally NOT routed
through here: it is best-effort (must never block sign-in) and swallows
tree/scope failures, whereas this helper is fail-hard and propagates them.
"""
from __future__ import annotations


async def create_project_with_tree(
    *,
    project_service,
    admin_service,
    name: str,
    description: str | None,
    org_id: str,
    created_by: str,
):
    """Create a project row, init its version tree, and ensure the root scope.

    Returns the created project. Propagates errors (fail-hard); callers needing
    best-effort semantics must not use this.
    """
    project = project_service.create(
        name=name,
        description=description,
        org_id=org_id,
        created_by=created_by,
    )
    project_id = str(project.id)
    await admin_service.init_tree(project_id)
    # Root scope creates the built-in access surfaces (Git Remote / FS CLI).
    # Imported lazily to mirror the router's existing lazy import and avoid any
    # import cycle through src.repo.
    from src.repo.scope_service import ScopeService

    ScopeService().ensure_root_scope(project_id)
    return project
