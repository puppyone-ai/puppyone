import os
import pytest


def _mock_response(status_code=200, json_data=None):
    class R:
        def __init__(self):
            self.status_code = status_code
            self._json = json_data or {}
            self.text = str(self._json)

        def json(self):
            return self._json

    return R()


@pytest.mark.unit
@pytest.mark.asyncio
async def test_remote_auth_valid(monkeypatch):
    os.environ["DEPLOYMENT_TYPE"] = "remote"
    os.environ["USER_SYSTEM_URL"] = "http://fake"
    os.environ["SERVICE_KEY"] = "svc"

    import server.auth as auth

    def fake_post(url, headers=None, timeout=None):
        return _mock_response(200, {"valid": True, "user": {"user_id": "u1"}})

    monkeypatch.setattr(auth.requests, "post", fake_post)

    provider = auth.get_auth_provider()
    user = await provider.verify_user_token("Bearer t")
    assert user.user_id == "u1"
    assert provider.requires_auth() is True


@pytest.mark.unit
@pytest.mark.asyncio
async def test_remote_auth_invalid_token(monkeypatch):
    os.environ["DEPLOYMENT_TYPE"] = "remote"

    import server.auth as auth

    def fake_post(url, headers=None, timeout=None):
        return _mock_response(200, {"valid": False})

    monkeypatch.setattr(auth.requests, "post", fake_post)

    provider = auth.get_auth_provider()
    with pytest.raises(auth.AuthenticationError):
        await provider.verify_user_token("t")


@pytest.mark.unit
@pytest.mark.asyncio
async def test_remote_auth_401_403(monkeypatch):
    os.environ["DEPLOYMENT_TYPE"] = "remote"
    import server.auth as auth

    def post_401(url, headers=None, timeout=None):
        return _mock_response(401, {})

    def post_403(url, headers=None, timeout=None):
        return _mock_response(403, {})

    monkeypatch.setattr(auth.requests, "post", post_401)
    provider = auth.get_auth_provider()
    with pytest.raises(auth.AuthenticationError) as e1:
        await provider.verify_user_token("t")
    assert e1.value.status_code == 401

    monkeypatch.setattr(auth.requests, "post", post_403)
    provider = auth.get_auth_provider()
    with pytest.raises(auth.AuthenticationError) as e2:
        await provider.verify_user_token("t")
    assert e2.value.status_code == 403


@pytest.mark.unit
@pytest.mark.asyncio
async def test_remote_auth_timeout_network(monkeypatch):
    os.environ["DEPLOYMENT_TYPE"] = "remote"
    import server.auth as auth

    class Timeout(Exception):
        pass

    def raise_timeout(url, headers=None, timeout=None):
        raise auth.requests.exceptions.Timeout()

    def raise_request_exc(url, headers=None, timeout=None):
        raise auth.requests.exceptions.RequestException("boom")

    monkeypatch.setattr(auth.requests, "post", raise_timeout)
    provider = auth.get_auth_provider()
    with pytest.raises(auth.AuthenticationError) as e1:
        await provider.verify_user_token("t")
    assert e1.value.status_code == 503

    monkeypatch.setattr(auth.requests, "post", raise_request_exc)
    provider = auth.get_auth_provider()
    with pytest.raises(auth.AuthenticationError) as e2:
        await provider.verify_user_token("t")
    assert e2.value.status_code == 503


