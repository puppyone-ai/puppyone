from __future__ import annotations

import asyncio
from typing import Annotated, Any
from urllib.parse import quote

from fastapi import APIRouter, Depends, Header

from src.config import settings
from src.exceptions import AppException, ErrorCode, ForbiddenException
from src.platform.auth.dependencies import get_current_user
from src.platform.auth.models import CurrentUser
from src.platform.billing.gateway import (
    BillingGatewayError,
    PuppyPayGateway,
    get_billing_gateway,
)
from src.platform.billing.models import (
    CancellationRequest,
    CheckoutRequest,
    PlanQuoteRequest,
    QuoteApplyRequest,
    RuntimeOverageRequest,
    SeatQuoteRequest,
    TopUpRequest,
)
from src.platform.billing.operations import BillingOperationRepository
from src.platform.billing.storage import StorageUsageRepository
from src.platform.entitlements.service import EntitlementService
from src.platform.organization.dependencies import get_org_service
from src.platform.organization.service import OrganizationService

router = APIRouter(prefix="/billing", tags=["billing"])
_SAFE_UPSTREAM_DETAIL_KEYS = {
    "available_units",
    "maximum",
    "maximum_limit_cents",
    "minimum",
    "minimum_limit_cents",
    "plan_id",
    "requested_units",
    "retention_minimum",
    "retry_after_seconds",
    "status",
}


def _require_ui() -> None:
    if not settings.BILLING_UI_ENABLED:
        raise AppException(
            code=ErrorCode.NOT_FOUND,
            status_code=404,
            message="Billing is not enabled",
        )


def _require_writes() -> None:
    _require_ui()
    if not settings.BILLING_WRITES_ENABLED:
        raise AppException(
            code=ErrorCode.FORBIDDEN,
            status_code=503,
            message="Billing changes are temporarily disabled",
            details={"code": "billing_writes_disabled"},
        )


async def _require_owner(
    org_service: OrganizationService,
    org_id: str,
    user_id: str,
) -> None:
    role = await asyncio.to_thread(org_service.get_my_role, org_id, user_id)
    if role != "owner":
        raise ForbiddenException("Organization owner role is required for billing")


def _idempotency_key(value: str | None) -> str:
    key = (value or "").strip()
    if not key or len(key) > 255:
        raise AppException(
            code=ErrorCode.BAD_REQUEST,
            status_code=400,
            message="Idempotency-Key is required and must not exceed 255 characters",
        )
    return key


def _translate(error: BillingGatewayError) -> AppException:
    upstream = error.payload.get("error") if isinstance(error.payload, dict) else None
    upstream = upstream if isinstance(upstream, dict) else {}
    raw_details = upstream.get("details")
    raw_details = raw_details if isinstance(raw_details, dict) else {}
    safe_details = {
        key: value for key, value in raw_details.items() if key in _SAFE_UPSTREAM_DETAIL_KEYS
    }
    return AppException(
        code=ErrorCode.BAD_REQUEST if error.status_code < 500 else ErrorCode.INTERNAL_SERVER_ERROR,
        status_code=error.status_code,
        message=str(upstream.get("message") or "Billing request failed"),
        details={
            "code": str(upstream.get("code") or "billing_request_failed"),
            "retryable": bool(upstream.get("retryable", error.status_code >= 500)),
            "upstream_details": safe_details,
        },
    )


def _usage_percent(value: int, limit: int | None) -> int | None:
    if limit is None:
        return None
    if limit == 0:
        return 0 if value == 0 else 100
    return min(100, int(value * 100 / limit))


async def _call(gateway: PuppyPayGateway, method: str, path: str, **kwargs: Any) -> dict[str, Any]:
    try:
        return await gateway.request(method, path, **kwargs)
    except BillingGatewayError as exc:
        raise _translate(exc) from exc


@router.get("/catalog")
async def catalog(gateway: PuppyPayGateway = Depends(get_billing_gateway)) -> dict[str, Any]:
    _require_ui()
    return await _call(gateway, "GET", "/api/v1/billing/catalog")


async def _authorized_org_call(
    *,
    gateway: PuppyPayGateway,
    org_service: OrganizationService,
    current_user: CurrentUser,
    authorization: str,
    org_id: str,
    method: str,
    suffix: str,
    body: dict[str, Any] | None = None,
    idempotency_key: str | None = None,
    write: bool = False,
) -> dict[str, Any]:
    _require_writes() if write else _require_ui()
    await _require_owner(org_service, org_id, current_user.user_id)
    # The Desktop bearer token terminates at PuppyOne. PuppyPay receives a
    # service-authenticated acting principal and independently rechecks billing
    # access against PuppyOne; no end-user credential crosses the trust boundary.
    del authorization
    return await _call(
        gateway,
        method,
        f"/api/v1/billing/organizations/{quote(org_id, safe='')}/{suffix}",
        actor_user_id=current_user.user_id,
        actor_email=current_user.email,
        idempotency_key=idempotency_key,
        body=body,
    )


@router.get("/organizations/{org_id}/summary")
async def summary(
    org_id: str,
    authorization: Annotated[str, Header(alias="Authorization")],
    current_user: CurrentUser = Depends(get_current_user),
    org_service: OrganizationService = Depends(get_org_service),
    gateway: PuppyPayGateway = Depends(get_billing_gateway),
) -> dict[str, Any]:
    return await _authorized_org_call(
        gateway=gateway,
        org_service=org_service,
        current_user=current_user,
        authorization=authorization,
        org_id=org_id,
        method="GET",
        suffix="summary",
    )


@router.get("/organizations/{org_id}/usage")
async def usage(
    org_id: str,
    authorization: Annotated[str, Header(alias="Authorization")],
    current_user: CurrentUser = Depends(get_current_user),
    org_service: OrganizationService = Depends(get_org_service),
    gateway: PuppyPayGateway = Depends(get_billing_gateway),
) -> dict[str, Any]:
    runtime = await _authorized_org_call(
        gateway=gateway,
        org_service=org_service,
        current_user=current_user,
        authorization=authorization,
        org_id=org_id,
        method="GET",
        suffix="usage",
    )
    storage, raw_limit = await asyncio.gather(
        asyncio.to_thread(StorageUsageRepository().get, org_id),
        asyncio.to_thread(EntitlementService().limit_value, org_id, "storage.max_bytes"),
    )
    limit_bytes = int(raw_limit) if raw_limit is not None else None
    percent = _usage_percent(storage.value, limit_bytes)
    return {
        "runtime": runtime,
        "storage": {
            "logical_bytes": storage.value,
            "limit_bytes": limit_bytes,
            "percent": percent,
            "threshold_percent": storage.threshold_percent,
            "version": storage.version,
        },
    }


@router.get("/organizations/{org_id}/operations")
async def operations(
    org_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    org_service: OrganizationService = Depends(get_org_service),
) -> list[dict[str, Any]]:
    _require_ui()
    await _require_owner(org_service, org_id, current_user.user_id)
    items = await asyncio.to_thread(BillingOperationRepository().list_for_org, org_id)
    return [item.model_dump(mode="json") for item in items]


def _body(value: Any) -> dict[str, Any]:
    body = value.model_dump(mode="json", exclude_none=True)
    # Product-side saga linkage is never part of PuppyPay's commercial
    # contract. It stays in PuppyOne and is stripped at the BFF boundary.
    body.pop("operation_id", None)
    return body


def _seat_operation(
    *,
    repository: BillingOperationRepository,
    org_id: str,
    operation_id: str,
    target_seat_quantity: int | None = None,
    quote_id: str | None = None,
):
    operation = repository.get_by_id(org_id, operation_id)
    if operation is None:
        raise AppException(
            code=ErrorCode.NOT_FOUND,
            status_code=404,
            message="Billing operation not found",
            details={"code": "billing_operation_not_found"},
        )
    if operation.kind not in {"member_activation", "member_deactivation"}:
        raise AppException(
            code=ErrorCode.BAD_REQUEST,
            status_code=409,
            message="Billing operation is not a seat operation",
            details={"code": "billing_operation_kind_mismatch"},
        )
    if operation.status in {"confirmed", "canceled"}:
        raise AppException(
            code=ErrorCode.BAD_REQUEST,
            status_code=409,
            message="Billing operation is already terminal",
            details={"code": "billing_operation_terminal"},
        )
    if target_seat_quantity is not None and operation.target_seat_quantity != target_seat_quantity:
        raise AppException(
            code=ErrorCode.BAD_REQUEST,
            status_code=409,
            message="Seat quote does not match the pending operation",
            details={"code": "billing_operation_seat_mismatch"},
        )
    if quote_id is not None and operation.quote_id not in {None, quote_id}:
        raise AppException(
            code=ErrorCode.BAD_REQUEST,
            status_code=409,
            message="Quote does not match the pending operation",
            details={"code": "billing_operation_quote_mismatch"},
        )
    return operation


@router.post("/organizations/{org_id}/plan/quote")
async def plan_quote(
    org_id: str,
    payload: PlanQuoteRequest,
    authorization: Annotated[str, Header(alias="Authorization")],
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
    current_user: CurrentUser = Depends(get_current_user),
    org_service: OrganizationService = Depends(get_org_service),
    gateway: PuppyPayGateway = Depends(get_billing_gateway),
) -> dict[str, Any]:
    return await _authorized_org_call(
        gateway=gateway,
        org_service=org_service,
        current_user=current_user,
        authorization=authorization,
        org_id=org_id,
        method="POST",
        suffix="plan/quote",
        body=_body(payload),
        idempotency_key=_idempotency_key(idempotency_key),
        write=True,
    )


@router.post("/organizations/{org_id}/seats/quote")
async def seat_quote(
    org_id: str,
    payload: SeatQuoteRequest,
    authorization: Annotated[str, Header(alias="Authorization")],
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
    current_user: CurrentUser = Depends(get_current_user),
    org_service: OrganizationService = Depends(get_org_service),
    gateway: PuppyPayGateway = Depends(get_billing_gateway),
) -> dict[str, Any]:
    _require_writes()
    await _require_owner(org_service, org_id, current_user.user_id)
    del authorization
    repository: BillingOperationRepository | None = None
    operation = None
    if payload.operation_id:
        repository = BillingOperationRepository()
        operation = await asyncio.to_thread(
            _seat_operation,
            repository=repository,
            org_id=org_id,
            operation_id=payload.operation_id,
            target_seat_quantity=payload.seat_quantity,
        )
    response = await _call(
        gateway,
        "POST",
        f"/api/v1/billing/organizations/{quote(org_id, safe='')}/seats/quote",
        actor_user_id=current_user.user_id,
        actor_email=current_user.email,
        idempotency_key=_idempotency_key(idempotency_key),
        body={"seat_quantity": payload.seat_quantity},
    )
    if repository is not None and operation is not None:
        await asyncio.to_thread(
            repository.update,
            operation.id,
            {
                "status": "quoted",
                "quote_id": response.get("quote_id"),
                "response_payload": {**operation.response_payload, "quote": response},
                "last_error": None,
            },
        )
    return response


async def _idempotent_mutation(
    *,
    org_id: str,
    suffix: str,
    payload: Any,
    authorization: str,
    idempotency_key: str | None,
    current_user: CurrentUser,
    org_service: OrganizationService,
    gateway: PuppyPayGateway,
    method: str = "POST",
) -> dict[str, Any]:
    return await _authorized_org_call(
        gateway=gateway,
        org_service=org_service,
        current_user=current_user,
        authorization=authorization,
        org_id=org_id,
        method=method,
        suffix=suffix,
        body=_body(payload) if payload is not None else None,
        idempotency_key=_idempotency_key(idempotency_key),
        write=True,
    )


@router.post("/organizations/{org_id}/checkout")
async def checkout(
    org_id: str,
    payload: CheckoutRequest,
    authorization: Annotated[str, Header(alias="Authorization")],
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
    current_user: CurrentUser = Depends(get_current_user),
    org_service: OrganizationService = Depends(get_org_service),
    gateway: PuppyPayGateway = Depends(get_billing_gateway),
) -> dict[str, Any]:
    return await _idempotent_mutation(
        org_id=org_id,
        suffix="checkout",
        payload=payload,
        authorization=authorization,
        idempotency_key=idempotency_key,
        current_user=current_user,
        org_service=org_service,
        gateway=gateway,
    )


@router.post("/organizations/{org_id}/plan/change")
async def plan_change(
    org_id: str,
    payload: QuoteApplyRequest,
    authorization: Annotated[str, Header(alias="Authorization")],
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
    current_user: CurrentUser = Depends(get_current_user),
    org_service: OrganizationService = Depends(get_org_service),
    gateway: PuppyPayGateway = Depends(get_billing_gateway),
) -> dict[str, Any]:
    return await _idempotent_mutation(
        org_id=org_id,
        suffix="plan/change",
        payload=payload,
        authorization=authorization,
        idempotency_key=idempotency_key,
        current_user=current_user,
        org_service=org_service,
        gateway=gateway,
    )


@router.post("/organizations/{org_id}/seats/change")
async def seats_change(
    org_id: str,
    payload: QuoteApplyRequest,
    authorization: Annotated[str, Header(alias="Authorization")],
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
    current_user: CurrentUser = Depends(get_current_user),
    org_service: OrganizationService = Depends(get_org_service),
    gateway: PuppyPayGateway = Depends(get_billing_gateway),
) -> dict[str, Any]:
    _require_writes()
    await _require_owner(org_service, org_id, current_user.user_id)
    del authorization
    repository: BillingOperationRepository | None = None
    operation = None
    if payload.operation_id:
        repository = BillingOperationRepository()
        operation = await asyncio.to_thread(
            _seat_operation,
            repository=repository,
            org_id=org_id,
            operation_id=payload.operation_id,
            quote_id=payload.quote_id,
        )
    response = await _call(
        gateway,
        "POST",
        f"/api/v1/billing/organizations/{quote(org_id, safe='')}/seats/change",
        actor_user_id=current_user.user_id,
        actor_email=current_user.email,
        idempotency_key=_idempotency_key(idempotency_key),
        body={"quote_id": payload.quote_id},
    )
    if repository is not None and operation is not None:
        await asyncio.to_thread(
            repository.update,
            operation.id,
            {
                "status": "submitted",
                "response_payload": {
                    **operation.response_payload,
                    "application": response,
                },
                "last_error": None,
            },
        )
    return response


@router.post("/organizations/{org_id}/subscription/cancel")
async def cancel(
    org_id: str,
    payload: CancellationRequest,
    authorization: Annotated[str, Header(alias="Authorization")],
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
    current_user: CurrentUser = Depends(get_current_user),
    org_service: OrganizationService = Depends(get_org_service),
    gateway: PuppyPayGateway = Depends(get_billing_gateway),
) -> dict[str, Any]:
    return await _idempotent_mutation(
        org_id=org_id,
        suffix="subscription/cancel",
        payload=payload,
        authorization=authorization,
        idempotency_key=idempotency_key,
        current_user=current_user,
        org_service=org_service,
        gateway=gateway,
    )


@router.post("/organizations/{org_id}/portal")
async def portal(
    org_id: str,
    authorization: Annotated[str, Header(alias="Authorization")],
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
    current_user: CurrentUser = Depends(get_current_user),
    org_service: OrganizationService = Depends(get_org_service),
    gateway: PuppyPayGateway = Depends(get_billing_gateway),
) -> dict[str, Any]:
    return await _idempotent_mutation(
        org_id=org_id,
        suffix="portal",
        payload=None,
        authorization=authorization,
        idempotency_key=idempotency_key,
        current_user=current_user,
        org_service=org_service,
        gateway=gateway,
    )


@router.post("/organizations/{org_id}/runtime/top-up")
async def runtime_top_up(
    org_id: str,
    payload: TopUpRequest,
    authorization: Annotated[str, Header(alias="Authorization")],
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
    current_user: CurrentUser = Depends(get_current_user),
    org_service: OrganizationService = Depends(get_org_service),
    gateway: PuppyPayGateway = Depends(get_billing_gateway),
) -> dict[str, Any]:
    return await _idempotent_mutation(
        org_id=org_id,
        suffix="runtime/top-up",
        payload=payload,
        authorization=authorization,
        idempotency_key=idempotency_key,
        current_user=current_user,
        org_service=org_service,
        gateway=gateway,
    )


@router.put("/organizations/{org_id}/runtime/overage")
async def runtime_overage(
    org_id: str,
    payload: RuntimeOverageRequest,
    authorization: Annotated[str, Header(alias="Authorization")],
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
    current_user: CurrentUser = Depends(get_current_user),
    org_service: OrganizationService = Depends(get_org_service),
    gateway: PuppyPayGateway = Depends(get_billing_gateway),
) -> dict[str, Any]:
    return await _idempotent_mutation(
        org_id=org_id,
        suffix="runtime/overage",
        payload=payload,
        authorization=authorization,
        idempotency_key=idempotency_key,
        current_user=current_user,
        org_service=org_service,
        gateway=gateway,
        method="PUT",
    )
