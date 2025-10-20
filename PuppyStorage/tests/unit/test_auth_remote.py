import os
import pytest
import httpx


class MockHttpxResponse:
    """Mock httpx.Response for testing"""
    def __init__(self, status_code=200, json_data=None, text_data=None):
        self.status_code = status_code
        self._json_data = json_data or {}
        self.text = text_data or str(self._json_data)

    def json(self):
        return self._json_data


@pytest.mark.unit
@pytest.mark.asyncio
async def test_remote_auth_valid(monkeypatch):
    os.environ["DEPLOYMENT_TYPE"] = "remote"
    os.environ["USER_SYSTEM_URL"] = "http://fake"
    os.environ["SERVICE_KEY"] = "svc"

    import server.auth as auth

    async def fake_post(self, url, **kwargs):
        return MockHttpxResponse(200, {"valid": True, "user": {"user_id": "u1"}})

    # Mock the AsyncClient.post method (note: includes 'self' parameter)
    monkeypatch.setattr("httpx.AsyncClient.post", fake_post)

    provider = auth.get_auth_provider()
    user = await provider.verify_user_token("Bearer t")
    assert user.user_id == "u1"
    assert provider.requires_auth() is True


@pytest.mark.unit
@pytest.mark.asyncio
async def test_remote_auth_invalid_token(monkeypatch):
    os.environ["DEPLOYMENT_TYPE"] = "remote"

    import server.auth as auth

    async def fake_post(self, url, **kwargs):
        return MockHttpxResponse(200, {"valid": False})

    monkeypatch.setattr("httpx.AsyncClient.post", fake_post)

    provider = auth.get_auth_provider()
    with pytest.raises(auth.AuthenticationError):
        await provider.verify_user_token("t")


@pytest.mark.unit
@pytest.mark.asyncio
async def test_remote_auth_401_403(monkeypatch):
    os.environ["DEPLOYMENT_TYPE"] = "remote"
    import server.auth as auth

    async def post_401(self, url, **kwargs):
        return MockHttpxResponse(401, {})

    async def post_403(self, url, **kwargs):
        return MockHttpxResponse(403, {})

    monkeypatch.setattr("httpx.AsyncClient.post", post_401)
    provider = auth.get_auth_provider()
    with pytest.raises(auth.AuthenticationError) as e1:
        await provider.verify_user_token("t")
    assert e1.value.status_code == 401

    monkeypatch.setattr("httpx.AsyncClient.post", post_403)
    provider = auth.get_auth_provider()
    with pytest.raises(auth.AuthenticationError) as e2:
        await provider.verify_user_token("t")
    assert e2.value.status_code == 403


@pytest.mark.unit
@pytest.mark.asyncio
async def test_remote_auth_timeout_network(monkeypatch):
    os.environ["DEPLOYMENT_TYPE"] = "remote"
    import server.auth as auth

    async def raise_timeout(self, url, **kwargs):
        raise httpx.TimeoutException("Timeout")

    async def raise_request_exc(self, url, **kwargs):
        raise httpx.RequestError("Network error")

    monkeypatch.setattr("httpx.AsyncClient.post", raise_timeout)
    provider = auth.get_auth_provider()
    with pytest.raises(auth.AuthenticationError) as e1:
        await provider.verify_user_token("t")
    assert e1.value.status_code == 503

    monkeypatch.setattr("httpx.AsyncClient.post", raise_request_exc)
    provider = auth.get_auth_provider()
    with pytest.raises(auth.AuthenticationError) as e2:
        await provider.verify_user_token("t")
    assert e2.value.status_code == 503


