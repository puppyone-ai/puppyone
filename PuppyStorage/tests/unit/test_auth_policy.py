import os
import pytest


class FakeProvider:
    def __init__(self, requires=True, user_id="u1"):
        self._requires = requires
        self._user_id = user_id

    def requires_auth(self) -> bool:
        return self._requires

    async def verify_user_token(self, token: str):
        from server.auth import User
        return User(user_id=self._user_id)


@pytest.mark.unit
def test_check_resource_ownership():
    from server.auth import check_resource_ownership
    assert check_resource_ownership("u1", "u1/b1/v1/file.txt") is True
    assert check_resource_ownership("u1", "u2/b1/v1/file.txt") is False
    assert check_resource_ownership("u1", "badkey") is False
    assert check_resource_ownership("u1", "") is False


@pytest.mark.unit
@pytest.mark.asyncio
async def test_verify_user_and_resource_access_relaxed():
    os.environ["DEPLOYMENT_TYPE"] = "local"
    os.environ["STRICT_LOCAL_AUTH"] = "false"
    from server.auth import verify_user_and_resource_access

    user = await verify_user_and_resource_access(
        resource_key="u1/b1/v1/f",
        authorization=None,
        auth_provider=FakeProvider(requires=False, user_id="u1"),
    )
    assert user.user_id == "u1"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_verify_user_and_resource_access_require_auth_ok():
    from server.auth import verify_user_and_resource_access

    user = await verify_user_and_resource_access(
        resource_key="u1/b1/v1/f",
        authorization="Bearer t",
        auth_provider=FakeProvider(requires=True, user_id="u1"),
    )
    assert user.user_id == "u1"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_verify_user_and_resource_access_require_auth_missing_header():
    import server.auth as auth

    with pytest.raises(auth.HTTPException) as e:
        await auth.verify_user_and_resource_access(
            resource_key="u1/b1/v1/f",
            authorization=None,
            auth_provider=FakeProvider(requires=True, user_id="u1"),
        )
    assert e.value.status_code == 401


@pytest.mark.unit
@pytest.mark.asyncio
async def test_verify_user_and_resource_access_forbidden():
    import server.auth as auth

    with pytest.raises(auth.HTTPException) as e:
        await auth.verify_user_and_resource_access(
            resource_key="u2/b1/v1/f",
            authorization="Bearer t",
            auth_provider=FakeProvider(requires=True, user_id="u1"),
        )
    assert e.value.status_code == 403


@pytest.mark.unit
@pytest.mark.asyncio
async def test_create_auth_dependency_missing_key():
    import server.auth as auth

    dep = auth.create_auth_dependency(key_field="key")
    with pytest.raises(auth.HTTPException) as e:
        await dep({}, authorization="Bearer t", auth_provider=FakeProvider())
    assert e.value.status_code == 400


