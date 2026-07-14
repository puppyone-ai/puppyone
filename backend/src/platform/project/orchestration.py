"""Shared create-chain for born-owned projects.

`create_project` (router) and `landing.claim` both need the same two steps:
create the Project row and initialize its canonical version tree. Project is
itself the root repository target; callers may layer real path Scopes or access
surfaces on afterwards.

The demo-seed path (``auth/initialization``) is intentionally NOT routed
through here: it is best-effort (must never block sign-in) and swallows
tree failures, whereas this helper is fail-hard and propagates them.
"""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


async def create_project_with_tree(
    *,
    project_service,
    admin_service,
    name: str,
    description: str | None,
    org_id: str,
    created_by: str,
):
    """Create a Project row and initialize its canonical version tree.

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
    try:
        await admin_service.init_tree(project_id)
    except Exception:
        # Creating a Project is one application operation. Do not strand a
        # visible container when its canonical tree failed.
        try:
            project_service.delete(project_id)
        except Exception:
            logger.exception("Unable to compensate failed Project %s", project_id)
        raise
    return project
