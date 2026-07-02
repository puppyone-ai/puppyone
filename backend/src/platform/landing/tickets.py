"""Signed landing tickets.

A ticket is a self-contained capability token handed to an anonymous browser
after ``/landing/preview`` and presented back at ``/landing/claim``. It carries
the S3 location of the parsed content plus the tool kind, signed with HMAC so a
client cannot forge one or point a claim at someone else's S3 object.

This is intentionally NOT a JWT / auth token — it grants no identity, only the
right to turn one already-parsed preview into a real project for whoever is
logged in at claim time. Stdlib-only (no new deps).
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time

from src.config import settings


class TicketError(Exception):
    """Raised when a ticket is malformed, has a bad signature, or is expired."""


def _secret() -> bytes:
    secret = settings.JWT_SECRET or ""
    if not secret:
        # JWT_SECRET is always set in any real deployment (it backs auth too);
        # fail loudly rather than sign with an empty key.
        raise TicketError("JWT_SECRET is not configured; cannot sign landing tickets")
    return secret.encode("utf-8")


def _b64e(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _b64d(value: str) -> bytes:
    pad = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + pad)


def _sign(payload_b64: str) -> str:
    sig = hmac.new(_secret(), payload_b64.encode("ascii"), hashlib.sha256).digest()
    return _b64e(sig)


def sign_ticket(payload: dict) -> str:
    """Sign ``payload`` (which MUST already contain an integer ``exp``)."""
    if "exp" not in payload:
        raise TicketError("ticket payload must include 'exp'")
    raw = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    payload_b64 = _b64e(raw)
    return f"{payload_b64}.{_sign(payload_b64)}"


def verify_ticket(token: str) -> dict:
    """Return the validated payload, or raise :class:`TicketError`."""
    if not token or "." not in token:
        raise TicketError("malformed ticket")
    payload_b64, _, sig_b64 = token.partition(".")
    expected = _sign(payload_b64)
    # constant-time compare on the base64 signatures
    if not hmac.compare_digest(sig_b64, expected):
        raise TicketError("bad signature")
    try:
        payload = json.loads(_b64d(payload_b64))
    except Exception as exc:  # noqa: BLE001 - any decode failure is a bad ticket
        raise TicketError(f"undecodable payload: {exc}") from exc
    if not isinstance(payload, dict):
        raise TicketError("payload is not an object")
    if int(payload.get("exp", 0)) < int(time.time()):
        raise TicketError("ticket expired")
    return payload
