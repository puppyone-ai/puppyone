"""Create an independent Project from one verified immutable release."""

from __future__ import annotations

import logging
from dataclasses import dataclass

from src.platform.entitlements.service import EntitlementService
from src.platform.project.models import Project
from src.platform.project.orchestration import create_project_with_tree
from src.platform.project.service import ProjectService
from src.version_engine.adapters.product.commands import VersionWriteCommandService
from src.version_engine.read.admin import VersionAdminService

from .service import TemplateRegistryService

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class TemplateInstantiationResult:
    template_id: str
    release_id: str
    project: Project


class TemplateInstantiationService:
    def __init__(
        self,
        *,
        registry: TemplateRegistryService,
        projects: ProjectService,
        entitlements: EntitlementService,
        version_admin: VersionAdminService,
        write_commands: VersionWriteCommandService,
    ) -> None:
        self.registry = registry
        self.projects = projects
        self.entitlements = entitlements
        self.version_admin = version_admin
        self.write_commands = write_commands

    async def instantiate(
        self,
        *,
        template_id: str,
        release_id: str | None,
        project_name: str | None,
        project_description: str | None,
        org_id: str,
        actor_user_id: str,
    ) -> TemplateInstantiationResult:
        status = self.registry.status()
        if not status.instantiation_enabled:
            from .exceptions import TemplateRegistryUnavailableError

            raise TemplateRegistryUnavailableError(
                status.reason or "template instantiation is disabled"
            )

        self.entitlements.require_capacity(
            org_id,
            "projects.max",
            current_count=len(self.projects.get_by_org_id(org_id)),
        )

        # The complete artifact is downloaded and verified before creating any
        # destination state. This is the most important failure boundary.
        resolved = await self.registry.resolve_release(
            template_id=template_id,
            release_id=release_id,
        )
        project: Project | None = None
        try:
            project = await create_project_with_tree(
                project_service=self.projects,
                admin_service=self.version_admin,
                name=project_name or resolved.template.name,
                description=(
                    project_description
                    if project_description is not None
                    else resolved.template.description
                ),
                org_id=org_id,
                created_by=actor_user_id,
            )
            await self.write_commands.bulk_write(
                str(project.id),
                resolved.bundle.files,
                actor=actor_user_id,
                message=f"template:{template_id}@{resolved.release.id}",
            )
        except Exception:
            if project is not None:
                try:
                    self.projects.delete(str(project.id))
                except Exception:
                    logger.exception("Unable to compensate failed template Project %s", project.id)
            raise

        assert project is not None
        return TemplateInstantiationResult(
            template_id=template_id,
            release_id=resolved.release.id,
            project=project,
        )
