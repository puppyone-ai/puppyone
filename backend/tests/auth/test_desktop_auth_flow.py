import base64
import hashlib
from urllib.parse import parse_qs, urlsplit

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from src.platform.auth import router as auth_router
from src.platform.auth.desktop_auth_store import InMemoryDesktopAuthStore
from src.platform.auth.models import CurrentUser


CALLBACK_URL = "http://127.0.0.1:43123/auth/callback"
VERIFIER = "v" * 43
CHALLENGE = base64.urlsafe_b64encode(
    hashlib.sha256(VERIFIER.encode("ascii")).digest()
).rstrip(b"=").decode("ascii")


@pytest.fixture(autouse=True)
def isolated_desktop_auth_store(monkeypatch):
    monkeypatch.setattr(auth_router, "_desktop_auth_store", InMemoryDesktopAuthStore())
    monkeypatch.setattr(auth_router.settings, "FRONTEND_URL", "http://localhost:3000")


def test_desktop_auth_requires_and_verifies_pkce_and_consumes_code_once():
    state = _start_auth()
    redirect_url = _complete_auth(state)
    query = parse_qs(urlsplit(redirect_url).query)

    result = auth_router.exchange_desktop_auth(auth_router.DesktopAuthExchangeRequest(
        code=query["code"][0],
        state=state,
        code_verifier=VERIFIER,
        redirect_uri=CALLBACK_URL,
    ))

    assert result.data.user_email == "user@example.com"
    with pytest.raises(HTTPException) as replay:
        auth_router.exchange_desktop_auth(auth_router.DesktopAuthExchangeRequest(
            code=query["code"][0],
            state=state,
            code_verifier=VERIFIER,
            redirect_uri=CALLBACK_URL,
        ))
    assert replay.value.status_code == 401


def test_wrong_pkce_verifier_fails_closed_and_burns_the_one_time_code():
    state = _start_auth()
    query = parse_qs(urlsplit(_complete_auth(state)).query)

    with pytest.raises(HTTPException) as mismatch:
        auth_router.exchange_desktop_auth(auth_router.DesktopAuthExchangeRequest(
            code=query["code"][0],
            state=state,
            code_verifier="x" * 43,
            redirect_uri=CALLBACK_URL,
        ))
    assert mismatch.value.status_code == 401

    with pytest.raises(HTTPException) as consumed:
        auth_router.exchange_desktop_auth(auth_router.DesktopAuthExchangeRequest(
            code=query["code"][0],
            state=state,
            code_verifier=VERIFIER,
            redirect_uri=CALLBACK_URL,
        ))
    assert consumed.value.status_code == 401


@pytest.mark.parametrize("callback_url", [
    "http://localhost:43123/auth/callback",
    "puppyone://auth/callback",
    "http://127.0.0.1:43123/auth/callback?unexpected=1",
])
def test_desktop_callback_accepts_only_an_exact_loopback_ip_redirect(callback_url):
    with pytest.raises(HTTPException) as invalid:
        auth_router._normalize_desktop_auth_callback_url(callback_url)
    assert invalid.value.status_code == 400


@pytest.mark.parametrize("method,challenge", [
    ("plain", VERIFIER),
    ("S256", "short"),
    ("", CHALLENGE),
])
def test_desktop_start_rejects_pkce_downgrades(method, challenge):
    with pytest.raises(HTTPException) as invalid:
        auth_router.start_desktop_auth(auth_router.DesktopAuthStartRequest(
            callback_url=CALLBACK_URL,
            code_challenge=challenge,
            code_challenge_method=method,
        ))
    assert invalid.value.status_code == 400


def test_memory_store_expires_and_atomically_consumes_transactions():
    clock = [10.0]
    store = InMemoryDesktopAuthStore(now=lambda: clock[0])
    assert store.create_state("state", {"value": 1}, 5) is True
    assert store.create_state("state", {"value": 2}, 5) is False
    assert store.consume_state("state") == {"value": 1}
    assert store.consume_state("state") is None

    assert store.create_code("code", {"value": 3}, 5) is True
    clock[0] = 16.0
    assert store.consume_code("code") is None


def _start_auth() -> str:
    response = auth_router.start_desktop_auth(auth_router.DesktopAuthStartRequest(
        callback_url=CALLBACK_URL,
        code_challenge=_challenge(VERIFIER),
        code_challenge_method="S256",
    ))
    return response.data.state


def _complete_auth(state: str) -> str:
    request = Request({
        "type": "http",
        "method": "POST",
        "path": "/api/v1/auth/desktop/complete",
        "headers": [(b"authorization", b"Bearer access-token")],
    })
    response = auth_router.complete_desktop_auth(
        auth_router.DesktopAuthCompleteRequest(
            state=state,
            access_token="access-token",
            refresh_token="refresh-token",
            expires_in=3600,
            user_email="user@example.com",
        ),
        request,
        CurrentUser(
            user_id="user-1",
            email="user@example.com",
            role="authenticated",
        ),
    )
    return response.data.redirect_url


def _challenge(verifier: str) -> str:
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
