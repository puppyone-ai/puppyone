import logging

import pytest

from src.turbopuffer.config import TurbopufferConfig


def test_config_missing_api_key_warns(monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture) -> None:
    monkeypatch.delenv("TURBOPUFFER_API_KEY", raising=False)

    caplog.set_level(logging.WARNING)
    cfg = TurbopufferConfig()

    assert cfg.configured is False
    assert any("TURBOPUFFER_API_KEY is not set" in r.message for r in caplog.records)


def test_config_present_api_key_no_warn(monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture) -> None:
    monkeypatch.setenv("TURBOPUFFER_API_KEY", "tpuf-secret")

    caplog.set_level(logging.WARNING)
    cfg = TurbopufferConfig()

    assert cfg.configured is True
    assert all("TURBOPUFFER_API_KEY is not set" not in r.message for r in caplog.records)


