import pytest

from src.sandbox.service import SandboxService


class FakeFiles:
    def __init__(self):
        self._store = {}

    async def write(self, path: str, content: str):
        self._store[path] = content

    async def read(self, path: str):
        return self._store[path]


class FakeCommands:
    def run(self, command: str):
        return type("Result", (), {"text": f"ran: {command}"})


class FakeSandbox:
    def __init__(self):
        self.files = FakeFiles()
        self.commands = FakeCommands()
        self.id = "fake"
        self.closed = False

    async def close(self):
        self.closed = True


@pytest.fixture
def sandbox_service():
    return SandboxService(sandbox_factory=lambda: FakeSandbox())


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
async def test_sandbox_start_requires_data(sandbox_service):
    result = await sandbox_service.start(
        session_id="s1", data=None, readonly=False
    )
    assert result["success"] is False


@pytest.mark.anyio
async def test_sandbox_exec_read_and_stop(sandbox_service):
    await sandbox_service.start(session_id="s1", data={"a": 1}, readonly=False)
    exec_result = await sandbox_service.exec("s1", "echo ok")
    assert exec_result["success"] is True
    assert "echo ok" in exec_result["output"]

    read_result = await sandbox_service.read("s1")
    assert read_result["success"] is True
    assert read_result["data"] == {"a": 1}

    stop_result = await sandbox_service.stop("s1")
    assert stop_result["success"] is True
