"""C-3 — /internal/* endpoints must declare X-Acting-User-Id and verify the
acting user has access to the targeted project.

The vulnerability: holders of the internal SECRET could read/write any
project by varying the project_id payload. After this fix, every
project-scoped /internal/nodes/* endpoint additionally requires
X-Acting-User-Id and verifies that user has access.

These tests exercise the helper directly so they don't depend on a live
FastAPI request lifecycle (which would still need DB stubs).
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException, Request

from src.internal.router import _enforce_acting_user_project_access


def _fake_request(headers: dict[str, str]) -> Request:
    """Build a minimal Request with the given headers."""
    scope = {
        "type": "http",
        "headers": [
            (k.lower().encode(), v.encode()) for k, v in headers.items()
        ],
    }
    return Request(scope)


def test_missing_project_id_returns_400():
    req = _fake_request({"x-acting-user-id": "user-1"})
    with pytest.raises(HTTPException) as exc:
        _enforce_acting_user_project_access(req, "")
    assert exc.value.status_code == 400


def test_missing_acting_user_returns_400():
    """Even with a valid secret, a project-scoped call without the
    acting-user header must be rejected."""
    req = _fake_request({})  # no header
    with pytest.raises(HTTPException) as exc:
        _enforce_acting_user_project_access(req, "project-x")
    assert exc.value.status_code == 400
    assert "X-Acting-User-Id" in str(exc.value.detail)


def test_acting_user_with_no_access_returns_403():
    """Acting user that doesn't belong to the project → 403."""
    req = _fake_request({"x-acting-user-id": "intruder-uuid"})
    with patch(
        "src.internal.router.ProjectRepositorySupabase"
    ) as repo_cls:
        repo_cls.return_value.verify_project_access.return_value = None
        with pytest.raises(HTTPException) as exc:
            _enforce_acting_user_project_access(req, "project-x")
    assert exc.value.status_code == 403


def test_acting_user_with_access_returns_user_id():
    """Acting user that DOES have access → returns the user_id (the auth
    helper's contract, used by handlers to know who is operating)."""
    req = _fake_request({"x-acting-user-id": "alice-uuid"})
    with patch(
        "src.internal.router.ProjectRepositorySupabase"
    ) as repo_cls:
        repo_cls.return_value.verify_project_access.return_value = "member"
        result = _enforce_acting_user_project_access(req, "project-x")
    assert result == "alice-uuid"


def test_db_error_during_check_returns_503():
    """If the access check itself errors (DB outage etc.), fail closed
    with a transient 503 — never a quiet allow."""
    req = _fake_request({"x-acting-user-id": "alice-uuid"})
    with patch(
        "src.internal.router.ProjectRepositorySupabase"
    ) as repo_cls:
        repo_cls.return_value.verify_project_access.side_effect = RuntimeError(
            "DB down"
        )
        with pytest.raises(HTTPException) as exc:
            _enforce_acting_user_project_access(req, "project-x")
    assert exc.value.status_code == 503
