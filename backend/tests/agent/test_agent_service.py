import pytest

from src.agent.service import AgentService


@pytest.fixture
def agent_service():
    return AgentService()


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
async def test_agent_uses_bash_when_node_data_present(agent_service):
    result = await agent_service.should_use_bash(
        node_data={"a": 1}, bash_access=[{"path": "", "mode": "full"}]
    )
    assert result is True
