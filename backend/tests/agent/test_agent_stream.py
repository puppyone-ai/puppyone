import pytest

from src.agent.schemas import AgentRequest
from src.agent.service import AgentService


class FakeTextBlock:
    def __init__(self, text: str):
        self.type = "text"
        self.text = text


class FakeToolUseBlock:
    def __init__(self, tool_id: str, name: str, input_data: dict):
        self.type = "tool_use"
        self.id = tool_id
        self.name = name
        self.input = input_data


class FakeResponse:
    def __init__(self, content, stop_reason="end_turn"):
        self.content = content
        self.stop_reason = stop_reason


class FakeMessages:
    def __init__(self, responses):
        self._responses = list(responses)

    async def create(self, **kwargs):
        return self._responses.pop(0)


class FakeAnthropicClient:
    def __init__(self, responses):
        self.messages = FakeMessages(responses)


class FakeSandboxService:
    def __init__(self):
        self.exec_calls = []
        self.read_data = {"a": 1}
        self.started = False

    async def start(self, session_id: str, data, readonly: bool):
        self.started = True
        return {"success": True}

    async def exec(self, session_id: str, command: str):
        self.exec_calls.append(command)
        return {"success": True, "output": "ok"}

    async def read(self, session_id: str):
        return {"success": True, "data": self.read_data}

    async def stop(self, session_id: str):
        return {"success": True}


class FakeTable:
    def __init__(self, data):
        self.data = data


class FakeTableService:
    def __init__(self, data):
        self.table = FakeTable(data)

    def get_by_id_with_access_check(self, table_id: int, user_id: str):
        return self.table


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
async def test_stream_events_text_only():
    client = FakeAnthropicClient([FakeResponse([FakeTextBlock("hello")])])
    service = AgentService(anthropic_client=client)
    request = AgentRequest(prompt="hi")

    events = []
    async for event in service.stream_events(
        request=request,
        current_user=None,
        table_service=None,
        sandbox_service=FakeSandboxService(),
    ):
        events.append(event)

    assert any(e["type"] == "text" and e["content"] == "hello" for e in events)


@pytest.mark.anyio
async def test_stream_events_bash_tool_calls_sandbox():
    responses = [
        FakeResponse(
            [FakeToolUseBlock("tool-1", "bash", {"command": "echo ok"})]
        ),
        FakeResponse([FakeTextBlock("done")]),
    ]
    client = FakeAnthropicClient(responses)
    sandbox_service = FakeSandboxService()
    table_service = FakeTableService({"a": 1})
    service = AgentService(anthropic_client=client)
    request = AgentRequest(
        prompt="hi",
        table_id=1,
        bashAccessPoints=[{"path": "", "mode": "readonly"}],
    )

    events = []
    async for event in service.stream_events(
        request=request,
        current_user=type("User", (), {"user_id": "u1"}),
        table_service=table_service,
        sandbox_service=sandbox_service,
    ):
        events.append(event)

    assert sandbox_service.started is True
    assert "echo ok" in sandbox_service.exec_calls
    assert any(e["type"] == "tool_start" for e in events)
    assert any(e["type"] == "tool_end" for e in events)
