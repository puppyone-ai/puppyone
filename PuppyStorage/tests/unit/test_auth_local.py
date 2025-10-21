import os
import pytest


@pytest.mark.unit
def test_local_auth_relaxed_mode(monkeypatch):
    os.environ["DEPLOYMENT_TYPE"] = "local"
    os.environ["STRICT_LOCAL_AUTH"] = "false"

    from server.auth import get_auth_provider

    provider = get_auth_provider()
    # relaxed: no token required
    user = pytest.run(async_fn=provider.verify_user_token, args=("",)) if hasattr(pytest, "run") else None
    # Fallback to simple await pattern using pytest.mark.asyncio


@pytest.mark.unit
@pytest.mark.asyncio
async def test_local_auth_relaxed_mode_async(monkeypatch):
    os.environ["DEPLOYMENT_TYPE"] = "local"
    os.environ["STRICT_LOCAL_AUTH"] = "false"

    from server.auth import get_auth_provider

    provider = get_auth_provider()
    user = await provider.verify_user_token("")
    assert user.user_id == "local-user"
    assert provider.requires_auth() is False


@pytest.mark.unit
@pytest.mark.asyncio
async def test_local_auth_strict_mode_valid_token(monkeypatch):
    os.environ["DEPLOYMENT_TYPE"] = "local"
    os.environ["STRICT_LOCAL_AUTH"] = "true"

    from server.auth import get_auth_provider

    provider = get_auth_provider()
    user = await provider.verify_user_token("Bearer valid_token_12345")
    assert user.user_id == "local-user"
    assert provider.requires_auth() is True


@pytest.mark.unit
@pytest.mark.asyncio
async def test_local_auth_strict_mode_invalid_token(monkeypatch):
    os.environ["DEPLOYMENT_TYPE"] = "local"
    os.environ["STRICT_LOCAL_AUTH"] = "true"

    from server.auth import get_auth_provider, AuthenticationError

    provider = get_auth_provider()
    with pytest.raises(AuthenticationError):
        await provider.verify_user_token("invalid_token")


