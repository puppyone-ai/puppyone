from __future__ import annotations

from urllib.parse import parse_qs, urlsplit

import pytest
from fastapi import HTTPException

from src.platform.auth import router as auth_router
from src.platform.auth.shared_security_store import SecurityStoreUnavailable


CALLBACK_URL = "puppyone://auth/callback"


class _MemorySecurityStore:
    """Minimal atomic TTL-store fake for exercising the replica-safe flow."""

    def __init__(self) -> None:
        self.values: dict[tuple[str, str], dict] = {}
        self.puts: list[tuple[str, str, dict, int]] = []

    def put(self, namespace: str, key: str, value: dict, ttl_seconds: int) -> None:
        self.values[(namespace, key)] = dict(value)
        self.puts.append((namespace, key, dict(value), ttl_seconds))

    def consume(self, namespace: str, key: str) -> dict | None:
        return self.values.pop((namespace, key), None)

    def hit(self, bucket: str, subject: str, limit: int, window_seconds: int) -> bool:
        return False


class _FakeTokenResponse:
    status_code = 200

    @staticmethod
    def json() -> dict:
        return {
            "access_token": "access-token",
            "refresh_token": "refresh-token",
            "expires_in": 3600,
            "user": {"email": "user@example.com"},
        }


class _FakeAsyncClient:
    def __init__(self) -> None:
        self.posted_url = ""
        self.posted_headers: dict = {}
        self.posted_json: dict = {}

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args) -> None:
        return None

    async def post(self, url: str, *, headers: dict, json: dict):
        self.posted_url = url
        self.posted_headers = headers
        self.posted_json = json
        return _FakeTokenResponse()


@pytest.fixture(autouse=True)
def configured_desktop_auth(monkeypatch):
    monkeypatch.setattr(auth_router.settings, "DESKTOP_AUTH_ALLOWED_CALLBACKS", CALLBACK_URL)
    monkeypatch.setattr(
        auth_router.settings,
        "DESKTOP_AUTH_PUBLIC_BASE_URL",
        "https://api.example.com",
    )
    monkeypatch.setattr(auth_router.settings, "SUPABASE_PUBLIC_URL", "https://auth.example.com")
    monkeypatch.setenv("SUPABASE_URL", "https://auth.internal")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "anon-key")


async def test_desktop_oauth_pkce_state_and_exchange_are_single_use(monkeypatch):
    store = _MemorySecurityStore()
    client = _FakeAsyncClient()
    monkeypatch.setattr(auth_router.httpx, "AsyncClient", lambda: client)

    started = auth_router.desktop_auth_start(
        auth_router.DesktopStartRequest(provider="github", callback_url=CALLBACK_URL),
        store=store,
    )
    state = started.data.state
    pending = store.values[("desktop-state", state)]
    authorize_query = parse_qs(urlsplit(started.data.login_url).query)

    assert authorize_query["provider"] == ["github"]
    assert authorize_query["code_challenge_method"] == ["s256"]
    assert authorize_query["code_challenge"][0]
    assert pending["callback_url"] == CALLBACK_URL
    assert pending["code_verifier"]

    redirected = await auth_router.desktop_auth_callback(
        code="provider-code",
        state=state,
        store=store,
    )
    callback_query = parse_qs(urlsplit(redirected.headers["location"]).query)
    exchange_code = callback_query["code"][0]

    assert callback_query["state"] == [state]
    assert client.posted_url == "https://auth.internal/auth/v1/token?grant_type=pkce"
    assert client.posted_json == {
        "auth_code": "provider-code",
        "code_verifier": pending["code_verifier"],
    }
    assert ("desktop-state", state) not in store.values

    exchanged = auth_router.desktop_auth_exchange(
        auth_router.DesktopExchangeRequest(code=exchange_code, state=state),
        store=store,
    )
    assert exchanged.data["access_token"] == "access-token"

    with pytest.raises(HTTPException) as replay:
        auth_router.desktop_auth_exchange(
            auth_router.DesktopExchangeRequest(code=exchange_code, state=state),
            store=store,
        )
    assert replay.value.status_code == 400


def test_desktop_exchange_state_mismatch_fails_closed_and_burns_code():
    store = _MemorySecurityStore()
    store.put(
        "desktop-exchange",
        "one-time-code",
        {"state": "expected", "session": {"access_token": "token"}},
        60,
    )

    with pytest.raises(HTTPException) as mismatch:
        auth_router.desktop_auth_exchange(
            auth_router.DesktopExchangeRequest(code="one-time-code", state="wrong"),
            store=store,
        )
    assert mismatch.value.status_code == 400

    with pytest.raises(HTTPException) as consumed:
        auth_router.desktop_auth_exchange(
            auth_router.DesktopExchangeRequest(code="one-time-code", state="expected"),
            store=store,
        )
    assert consumed.value.status_code == 400


@pytest.mark.parametrize(
    "callback_url",
    [
        "http://localhost:43123/auth/callback",
        "http://127.0.0.1:43123/auth/callback",
        "puppyone://auth/callback?unexpected=1",
    ],
)
def test_desktop_callback_requires_an_exact_allowlisted_redirect(callback_url):
    with pytest.raises(HTTPException) as invalid:
        auth_router._validate_desktop_callback(callback_url)
    assert invalid.value.status_code == 400


def test_desktop_start_rejects_unsupported_provider():
    with pytest.raises(HTTPException) as invalid:
        auth_router.desktop_auth_start(
            auth_router.DesktopStartRequest(provider="password", callback_url=CALLBACK_URL),
            store=_MemorySecurityStore(),
        )
    assert invalid.value.status_code == 400


def test_desktop_start_fails_closed_when_shared_store_is_unavailable():
    class _UnavailableStore(_MemorySecurityStore):
        def put(self, namespace: str, key: str, value: dict, ttl_seconds: int) -> None:
            raise SecurityStoreUnavailable("offline")

    with pytest.raises(HTTPException) as unavailable:
        auth_router.desktop_auth_start(
            auth_router.DesktopStartRequest(provider="google", callback_url=CALLBACK_URL),
            store=_UnavailableStore(),
        )
    assert unavailable.value.status_code == 503
