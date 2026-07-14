from __future__ import annotations

import pytest
from pydantic import ValidationError

from src.platform.project.router import _legacy_template_detail, _legacy_template_summary
from src.platform.project.schemas import ProjectCreate
from src.platform.template_registry.config import TemplateRegistrySettings
from src.platform.template_registry.providers.builtin import BuiltinTemplateRegistryProvider


@pytest.mark.asyncio
async def test_legacy_template_shapes_preserve_cover_version_and_preview_fields() -> None:
    provider = BuiltinTemplateRegistryProvider(TemplateRegistrySettings(_env_file=None))
    page = await provider.list_templates(
        query=None,
        category=None,
        cursor=None,
        limit=1,
    )
    detail = await provider.get_template(page.templates[0].id)

    summary_payload = _legacy_template_summary(page.templates[0])
    detail_payload = _legacy_template_detail(detail)

    assert "cover" in summary_payload
    assert detail_payload["version"] == detail.current_release.version
    assert "preview_doc" in detail_payload


def test_project_create_rejects_a_release_without_a_template_id() -> None:
    with pytest.raises(ValidationError, match="requires template"):
        ProjectCreate(name="Copy", template_release_id="1.0.0")
