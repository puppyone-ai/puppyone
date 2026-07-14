from __future__ import annotations

from types import SimpleNamespace

import pytest

from src.config import settings
from src.exceptions import AppException, ForbiddenException
from src.platform.billing.gateway import BillingGatewayError
from src.platform.billing.models import CheckoutRequest, PlanQuoteRequest
from src.platform.billing.router import (
    _translate,
    _usage_percent,
    catalog,
    checkout,
    plan_quote,
    summary,
)


class _Organizations:
    def __init__(self, role: str, org_id: str = "org-1") -> None:
        self.role = role
        self.org_id = org_id

    def get_my_role(self, org_id: str, user_id: str) -> str:
        assert org_id == self.org_id
        assert user_id == "user-1"
        return self.role


class _Gateway:
    def __init__(self, response: dict | None = None) -> None:
        self.response = response or {"ok": True}
        self.calls: list[tuple[str, str, dict]] = []

    async def request(self, method: str, path: str, **kwargs):
        self.calls.append((method, path, kwargs))
        return self.response


@pytest.fixture
def enabled(monkeypatch):
    monkeypatch.setattr(settings, "BILLING_UI_ENABLED", True)
    monkeypatch.setattr(settings, "BILLING_WRITES_ENABLED", True)


@pytest.mark.asyncio
async def test_catalog_is_fail_closed_when_ui_flag_is_disabled(monkeypatch) -> None:
    monkeypatch.setattr(settings, "BILLING_UI_ENABLED", False)
    gateway = _Gateway()
    with pytest.raises(AppException) as caught:
        await catalog(gateway=gateway)
    assert caught.value.status_code == 404
    assert gateway.calls == []


@pytest.mark.asyncio
async def test_billing_reads_require_owner_before_calling_puppypay(enabled) -> None:
    gateway = _Gateway()
    with pytest.raises(ForbiddenException):
        await summary(
            "org-1",
            authorization="Bearer desktop-token",
            current_user=SimpleNamespace(user_id="user-1", email="member@example.com"),
            org_service=_Organizations("member"),
            gateway=gateway,
        )
    assert gateway.calls == []


@pytest.mark.asyncio
async def test_checkout_requires_idempotency_and_uses_service_principal(enabled) -> None:
    gateway = _Gateway({"checkout_id": "checkout-1"})
    with pytest.raises(AppException) as missing:
        await checkout(
            "org-1",
            CheckoutRequest(plan_id="plus", seat_quantity=2),
            authorization="Bearer desktop-token",
            idempotency_key=None,
            current_user=SimpleNamespace(user_id="user-1", email="owner@example.com"),
            org_service=_Organizations("owner"),
            gateway=gateway,
        )
    assert missing.value.status_code == 400
    assert gateway.calls == []

    await checkout(
        "org-1",
        CheckoutRequest(plan_id="plus", seat_quantity=2),
        authorization="Bearer desktop-token",
        idempotency_key="desktop:checkout:1",
        current_user=SimpleNamespace(user_id="user-1", email="owner@example.com"),
        org_service=_Organizations("owner"),
        gateway=gateway,
    )
    _, _, kwargs = gateway.calls[0]
    assert "authorization" not in kwargs
    assert kwargs["actor_user_id"] == "user-1"
    assert kwargs["actor_email"] == "owner@example.com"
    assert kwargs["idempotency_key"] == "desktop:checkout:1"


@pytest.mark.asyncio
async def test_quote_requires_and_forwards_idempotency(enabled) -> None:
    gateway = _Gateway({"quote_id": "quote-1"})
    arguments = {
        "org_id": "org-1",
        "payload": PlanQuoteRequest(target_plan_id="plus", seat_quantity=2),
        "authorization": "Bearer desktop-token",
        "current_user": SimpleNamespace(user_id="user-1", email="owner@example.com"),
        "org_service": _Organizations("owner"),
        "gateway": gateway,
    }

    with pytest.raises(AppException) as missing:
        await plan_quote(**arguments, idempotency_key=None)
    assert missing.value.status_code == 400
    assert gateway.calls == []

    await plan_quote(**arguments, idempotency_key="desktop:plan-quote:1")
    assert gateway.calls[0][2]["idempotency_key"] == "desktop:plan-quote:1"


@pytest.mark.asyncio
async def test_billing_proxy_encodes_organization_path_segment(enabled) -> None:
    gateway = _Gateway({"org_id": "org/1"})

    await summary(
        "org/1",
        authorization="Bearer desktop-token",
        current_user=SimpleNamespace(user_id="user-1", email="owner@example.com"),
        org_service=_Organizations("owner", "org/1"),
        gateway=gateway,
    )

    assert gateway.calls[0][1] == "/api/v1/billing/organizations/org%2F1/summary"


def test_billing_proxy_does_not_forward_private_upstream_details() -> None:
    translated = _translate(
        BillingGatewayError(
            409,
            {
                "error": {
                    "code": "quote_conflict",
                    "message": "Quote conflict",
                    "details": {
                        "minimum": 1,
                        "provider_subscription_id": "sub_private",
                    },
                }
            },
        )
    )

    assert translated.details["upstream_details"] == {"minimum": 1}


def test_usage_percent_has_explicit_zero_quota_semantics() -> None:
    assert _usage_percent(0, 0) == 0
    assert _usage_percent(1, 0) == 100
    assert _usage_percent(50, 100) == 50
    assert _usage_percent(1, None) is None
