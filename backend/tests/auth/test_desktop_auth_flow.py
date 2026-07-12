from __future__ import annotations

import asyncio
from urllib.parse import parse_qs, urlsplit

import pytest
from fastapi import HTTPException

from src.platform.auth import router as auth_router
from src.platform.auth.shared_security_store import SecurityStoreUnavailable


CALLBACK_URL = "http://127.0.0.1:43123/auth/callback"


class MemoryAtomicTTLStore:
    """Test implementation of the production AtomicTTLStore contract."""

    def __init__(self):
        self.records: dict[tuple[str, str], dict] = {}

    def put(self, namespace, key, value, ttl_seconds):
        self.records[(namespace, key)] = dict(value)

    def consume(self, namespace, key):
        value = self.records.pop((namespace, key), None)
        return dict(value) if value is not None else None


class FakeResponse:
    status_code = 200

    def json(self):
        return {
            "access_token": "access-token",
            "refresh_token": "refresh-token",
            "expires_in": 3600,
            "user": {"id": "user-1", "email": "user@example.com"},
        }


class FakeAsyncClient:
    def __init__(self):
        self.calls = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return None

    async def post(self, url, **kwargs):
        self.calls.append((url, kwargs))
        return FakeResponse()


@pytest.fixture(autouse=True)
def desktop_oauth_settings(monkeypatch):
    monkeypatch.setattr(
        auth_router.settings, "DESKTOP_AUTH_ALLOWED_CALLBACKS", CALLBACK_URL
    )
    monkeypatch.setattr(
        auth_router.settings,
        "DESKTOP_AUTH_PUBLIC_BASE_URL",
        "https://api.example.com",
    )
    monkeypatch.setattr(
        auth_router.settings, "SUPABASE_PUBLIC_URL", "https://auth.example.com"
    )
    monkeypatch.setenv("SUPABASE_URL", "https://auth-internal.example.com")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "anon-key")


def test_desktop_oauth_state_and_exchange_codes_are_single_use(monkeypatch):
    store = MemoryAtomicTTLStore()
    client = FakeAsyncClient()
    monkeypatch.setattr(auth_router.httpx, "AsyncClient", lambda: client)

    state = _start_auth(store)
    redirect_url = _complete_auth(store, state)
    query = parse_qs(urlsplit(redirect_url).query)
    exchange_code = query["code"][0]

    result = auth_router.desktop_auth_exchange(
        auth_router.DesktopExchangeRequest(code=exchange_code, state=state),
        store=store,
    )
    assert result.data["user"]["email"] == "user@example.com"
    assert client.calls[0][1]["json"]["code_verifier"]

    with pytest.raises(HTTPException) as replay:
        auth_router.desktop_auth_exchange(
            auth_router.DesktopExchangeRequest(code=exchange_code, state=state),
            store=store,
        )
    assert replay.value.status_code == 400


def test_wrong_state_fails_closed_and_burns_exchange_code(monkeypatch):
    store = MemoryAtomicTTLStore()
    monkeypatch.setattr(auth_router.httpx, "AsyncClient", FakeAsyncClient)
    state = _start_auth(store)
    query = parse_qs(urlsplit(_complete_auth(store, state)).query)
    exchange_code = query["code"][0]

    with pytest.raises(HTTPException) as mismatch:
        auth_router.desktop_auth_exchange(
            auth_router.DesktopExchangeRequest(
                code=exchange_code, state="different-state"
            ),
            store=store,
        )
    assert mismatch.value.status_code == 400

    with pytest.raises(HTTPException) as consumed:
        auth_router.desktop_auth_exchange(
            auth_router.DesktopExchangeRequest(code=exchange_code, state=state),
            store=store,
        )
    assert consumed.value.status_code == 400


def test_start_generates_server_side_pkce_and_exact_redirect():
    store = MemoryAtomicTTLStore()
    response = auth_router.desktop_auth_start(
        auth_router.DesktopStartRequest(
            provider="github", callback_url=CALLBACK_URL
        ),
        store=store,
    )
    query = parse_qs(urlsplit(response.data.login_url).query)
    assert query["provider"] == ["github"]
    assert query["code_challenge_method"] == ["s256"]
    assert query["code_challenge"][0]
    assert query["redirect_to"] == [
        f"https://api.example.com/auth/desktop/callback?state={response.data.state}"
    ]
    pending = store.records[("desktop-state", response.data.state)]
    assert pending["callback_url"] == CALLBACK_URL
    assert len(pending["code_verifier"]) >= 43


@pytest.mark.parametrize(
    "callback_url",
    [
        "http://localhost:43123/auth/callback",
        "puppyone://auth/callback",
        "http://127.0.0.1:43123/auth/callback?unexpected=1",
    ],
)
def test_callback_accepts_only_exact_allowlisted_url(callback_url):
    with pytest.raises(HTTPException) as invalid:
        auth_router._validate_desktop_callback(callback_url)
    assert invalid.value.status_code == 400


@pytest.mark.parametrize("provider", ["", "email", "google-oauth"])
def test_start_rejects_unsupported_provider(provider):
    with pytest.raises(HTTPException) as invalid:
        auth_router.desktop_auth_start(
            auth_router.DesktopStartRequest(
                provider=provider, callback_url=CALLBACK_URL
            ),
            store=MemoryAtomicTTLStore(),
        )
    assert invalid.value.status_code == 400


def test_security_store_outage_fails_closed():
    class UnavailableStore:
        def put(self, *_args):
            raise SecurityStoreUnavailable("down")

    with pytest.raises(HTTPException) as unavailable:
        auth_router.desktop_auth_start(
            auth_router.DesktopStartRequest(
                provider="google", callback_url=CALLBACK_URL
            ),
            store=UnavailableStore(),
        )
    assert unavailable.value.status_code == 503


def _start_auth(store: MemoryAtomicTTLStore) -> str:
    response = auth_router.desktop_auth_start(
        auth_router.DesktopStartRequest(
            provider="google", callback_url=CALLBACK_URL
        ),
        store=store,
    )
    return response.data.state


def _complete_auth(store: MemoryAtomicTTLStore, state: str) -> str:
    response = asyncio.run(
        auth_router.desktop_auth_callback(
            code="provider-auth-code", state=state, store=store
        )
    )
    return response.headers["location"]
