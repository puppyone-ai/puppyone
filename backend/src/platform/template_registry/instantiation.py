"""Create an independent Project from one verified immutable release."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass

from src.platform.entitlements.service import EntitlementService
from src.platform.project.control_plane import ProjectControlPlaneService
from src.platform.project.models import Project
from src.platform.project.orchestration import create_project_with_tree
from src.version_engine.adapters.product.commands import VersionWriteCommandService
from src.version_engine.write_engine.engine import VersionWriteEngine

from .service import TemplateRegistryService


@dataclass(frozen=True)
class TemplateInstantiationResult:
    template_id: str
    release_id: str
    project: Project
    replayed: bool = False


class TemplateInstantiationService:
    def __init__(
        self,
        *,
        registry: TemplateRegistryService,
        control_plane: ProjectControlPlaneService,
        entitlements: EntitlementService,
        version_engine: VersionWriteEngine,
        write_commands: VersionWriteCommandService,
    ) -> None:
        self.registry = registry
        self.control_plane = control_plane
        self.entitlements = entitlements
        self.version_engine = version_engine
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
        operation_key: str,
    ) -> TemplateInstantiationResult:
        status = self.registry.status()
        if not status.instantiation_enabled:
            from .exceptions import TemplateRegistryUnavailableError

            raise TemplateRegistryUnavailableError(
                status.reason or "template instantiation is disabled"
            )

        # The complete artifact is downloaded and verified before creating any
        # destination state. This is the most important failure boundary.
        resolved = await self.registry.resolve_release(
            template_id=template_id,
            release_id=release_id,
        )
        project_limit = await asyncio.to_thread(
            self.entitlements.enforced_limit_value,
            org_id,
            "projects.max",
        )

        async def initialize(project: Project) -> None:
            await self.write_commands.bulk_write(
                str(project.id),
                resolved.bundle.files,
                actor=actor_user_id,
                message=f"template:{template_id}@{resolved.release.id}",
            )

        publication = await create_project_with_tree(
            control_plane=self.control_plane,
            version_engine=self.version_engine,
            operation_key=operation_key,
            name=project_name or resolved.template.name,
            description=(
                project_description
                if project_description is not None
                else resolved.template.description
            ),
            org_id=org_id,
            created_by=actor_user_id,
            project_limit=project_limit,
            publication_mode="deferred",
            source_fingerprint={
                "kind": "template-instantiation",
                "template_id": template_id,
                "release_id": resolved.release.id,
                "bundle_sha256": resolved.release.bundle_sha256,
            },
            initialize=initialize,
        )
        return TemplateInstantiationResult(
            template_id=template_id,
            release_id=resolved.release.id,
            project=publication.project,
            replayed=publication.replayed,
        )
