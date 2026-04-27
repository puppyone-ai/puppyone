"""Security test conftest — these tests verify auth ENFORCEMENT, so they
must run with the auth bypass DISABLED."""

import os

import pytest


@pytest.fixture(autouse=True)
def _disable_skip_auth(monkeypatch):
    """Hard-disable SKIP_AUTH for every test in this module.

    The global conftest sets SKIP_AUTH=true so unrelated unit tests can
    import without needing real auth. Security tests are different — the
    whole point is to check that the enforcement code path runs.
    """
    monkeypatch.setenv("SKIP_AUTH", "false")
    monkeypatch.setattr(
        "src.config.settings.SKIP_AUTH", False, raising=False,
    )
    yield
