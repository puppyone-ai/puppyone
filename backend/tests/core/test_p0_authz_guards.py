from __future__ import annotations

from unittest.mock import Mock

import pytest

from src.auth.models import CurrentUser
from src.content_node.router import _ensure_project_access
from src.exceptions import NotFoundException
from src.tool.service import ToolService


def _make_user(user_id: str = "u_test") -> CurrentUser:
    return CurrentUser(
        user_id=user_id,
        email="u@test.dev",
        role="authenticated",
        is_anonymous=False,
        app_metadata={},
        user_metadata={},
    )


def test_content_node_project_guard_denies_unauthorized_user() -> None:
    project_service = Mock()
    project_service.verify_project_access.return_value = False

    with pytest.raises(NotFoundException):
        _ensure_project_access(project_service, _make_user(), "project_123")

    project_service.verify_project_access.assert_called_once_with(
        "project_123", "u_test"
    )


def test_content_node_project_guard_allows_authorized_user() -> None:
    project_service = Mock()
    project_service.verify_project_access.return_value = True

    _ensure_project_access(project_service, _make_user(), "project_123")

    project_service.verify_project_access.assert_called_once_with(
        "project_123", "u_test"
    )


def test_tool_service_node_access_guard_denies_cross_project_user() -> None:
    repo = Mock()
    node_service = Mock()
    project_service = Mock()

    node = Mock()
    node.project_id = "project_other"
    node_service.get_by_id_unsafe.return_value = node
    project_service.verify_project_access.return_value = False

    service = ToolService(
        repo=repo,
        node_service=node_service,
        project_service=project_service,
    )

    with pytest.raises(NotFoundException):
        service.get_node_with_access_check("u_test", "node_123")

    node_service.get_by_id_unsafe.assert_called_once_with("node_123")
    project_service.verify_project_access.assert_called_once_with(
        "project_other", "u_test"
    )


def test_tool_service_node_access_guard_allows_owner_project() -> None:
    repo = Mock()
    node_service = Mock()
    project_service = Mock()

    node = Mock()
    node.project_id = "project_own"
    node_service.get_by_id_unsafe.return_value = node
    project_service.verify_project_access.return_value = True

    service = ToolService(
        repo=repo,
        node_service=node_service,
        project_service=project_service,
    )

    out = service.get_node_with_access_check("u_test", "node_123")

    assert out is node
    node_service.get_by_id_unsafe.assert_called_once_with("node_123")
    project_service.verify_project_access.assert_called_once_with(
        "project_own", "u_test"
    )

