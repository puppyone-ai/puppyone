import pytest

from src.sandbox.service import SandboxService


@pytest.fixture
def sandbox_service():
    return SandboxService()


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
async def test_sandbox_start_requires_data(sandbox_service):
    result = await sandbox_service.start(
        session_id="s1", data=None, readonly=False
    )
    assert result["success"] is False
