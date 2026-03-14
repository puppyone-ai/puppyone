import pytest

from src.connectors.agent.schemas import AgentRequest


def test_agent_request_requires_prompt():
    with pytest.raises(Exception):
        AgentRequest(prompt="")
