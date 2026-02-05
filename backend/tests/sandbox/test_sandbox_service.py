"""沙盒服务测试"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
import os

from src.sandbox.service import SandboxService, get_sandbox_type
from src.sandbox.e2b_sandbox import E2BSandbox
from src.sandbox.docker_sandbox import DockerSandbox


# ==================== Fake E2B 实现 ====================

class FakeFiles:
    """模拟 E2B files 接口"""
    def __init__(self):
        self._store = {}

    async def write(self, path: str, content: str):
        self._store[path] = content

    async def read(self, path: str):
        return self._store[path]


class FakeCommands:
    """模拟 E2B commands 接口"""
    def run(self, command: str):
        return type("Result", (), {"text": f"ran: {command}"})


class FakeSandbox:
    """模拟 E2B Sandbox"""
    def __init__(self):
        self.files = FakeFiles()
        self.commands = FakeCommands()
        self.id = "fake-e2b-sandbox"
        self.closed = False

    async def close(self):
        self.closed = True


# ==================== Fixtures ====================

@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture
def e2b_sandbox_service():
    """创建使用 Fake E2B 的 SandboxService"""
    e2b_impl = E2BSandbox(sandbox_factory=lambda: FakeSandbox())
    return SandboxService(sandbox_impl=e2b_impl)


@pytest.fixture
def sandbox_service():
    """向后兼容：使用 sandbox_factory 参数"""
    return SandboxService(sandbox_factory=lambda: FakeSandbox())


# ==================== E2B Sandbox 测试 ====================

@pytest.mark.anyio
async def test_e2b_sandbox_start_requires_data(e2b_sandbox_service):
    """测试 start() 需要数据参数"""
    result = await e2b_sandbox_service.start(
        session_id="s1", data=None, readonly=False
    )
    assert result["success"] is False
    assert "data is required" in result["error"]


@pytest.mark.anyio
async def test_e2b_sandbox_exec_read_and_stop(e2b_sandbox_service):
    """测试 E2B 沙盒的基本流程"""
    # 启动
    await e2b_sandbox_service.start(session_id="s1", data={"a": 1}, readonly=False)
    
    # 执行命令
    exec_result = await e2b_sandbox_service.exec("s1", "echo ok")
    assert exec_result["success"] is True
    assert "echo ok" in exec_result["output"]
    
    # 读取数据
    read_result = await e2b_sandbox_service.read("s1")
    assert read_result["success"] is True
    assert read_result["data"] == {"a": 1}
    
    # 停止
    stop_result = await e2b_sandbox_service.stop("s1")
    assert stop_result["success"] is True


@pytest.mark.anyio
async def test_e2b_sandbox_status(e2b_sandbox_service):
    """测试沙盒状态查询"""
    # 未启动时
    status = await e2b_sandbox_service.status("s1")
    assert status["active"] is False
    
    # 启动后
    await e2b_sandbox_service.start(session_id="s1", data={"test": 1}, readonly=True)
    status = await e2b_sandbox_service.status("s1")
    assert status["active"] is True
    assert status["readonly"] is True
    
    # 停止后
    await e2b_sandbox_service.stop("s1")
    status = await e2b_sandbox_service.status("s1")
    assert status["active"] is False


@pytest.mark.anyio
async def test_e2b_sandbox_read_file(e2b_sandbox_service):
    """测试读取指定文件"""
    await e2b_sandbox_service.start(session_id="s1", data={"key": "value"}, readonly=False)
    
    result = await e2b_sandbox_service.read_file("s1", "/workspace/data.json", parse_json=True)
    assert result["success"] is True
    assert result["content"] == {"key": "value"}


# ==================== 向后兼容测试 ====================

@pytest.mark.anyio
async def test_sandbox_start_requires_data(sandbox_service):
    """向后兼容：原有测试保持通过"""
    result = await sandbox_service.start(
        session_id="s1", data=None, readonly=False
    )
    assert result["success"] is False


@pytest.mark.anyio
async def test_sandbox_exec_read_and_stop(sandbox_service):
    """向后兼容：原有测试保持通过"""
    await sandbox_service.start(session_id="s1", data={"a": 1}, readonly=False)
    exec_result = await sandbox_service.exec("s1", "echo ok")
    assert exec_result["success"] is True
    assert "echo ok" in exec_result["output"]

    read_result = await sandbox_service.read("s1")
    assert read_result["success"] is True
    assert read_result["data"] == {"a": 1}

    stop_result = await sandbox_service.stop("s1")
    assert stop_result["success"] is True


# ==================== 工厂模式测试 ====================

def test_sandbox_type_property():
    """测试 sandbox_type 属性"""
    # E2B 实现
    e2b_impl = E2BSandbox(sandbox_factory=lambda: FakeSandbox())
    service = SandboxService(sandbox_impl=e2b_impl)
    assert service.sandbox_type == "e2b"
    
    # Docker 实现（不启动实际 Docker）
    docker_impl = DockerSandbox()
    service = SandboxService(sandbox_impl=docker_impl)
    assert service.sandbox_type == "docker"


def test_get_sandbox_type_with_e2b_key():
    """测试有 E2B_API_KEY 时返回 e2b"""
    with patch.dict(os.environ, {"E2B_API_KEY": "test-key"}):
        with patch("src.config.settings") as mock_settings:
            mock_settings.SANDBOX_TYPE = "auto"
            result = get_sandbox_type()
            assert result == "e2b"


def test_get_sandbox_type_without_e2b_key():
    """测试没有 E2B_API_KEY 时返回 docker"""
    # 保存原始环境变量
    original_key = os.environ.pop("E2B_API_KEY", None)
    try:
        with patch("src.config.settings") as mock_settings:
            mock_settings.SANDBOX_TYPE = "auto"
            result = get_sandbox_type()
            assert result == "docker"
    finally:
        # 恢复原始环境变量
        if original_key is not None:
            os.environ["E2B_API_KEY"] = original_key


def test_get_sandbox_type_explicit_docker():
    """测试显式设置 docker"""
    with patch("src.config.settings") as mock_settings:
        mock_settings.SANDBOX_TYPE = "docker"
        result = get_sandbox_type()
        assert result == "docker"


def test_get_sandbox_type_explicit_e2b():
    """测试显式设置 e2b"""
    with patch("src.config.settings") as mock_settings:
        mock_settings.SANDBOX_TYPE = "e2b"
        result = get_sandbox_type()
        assert result == "e2b"


# ==================== Docker Sandbox 测试 ====================

@pytest.mark.anyio
async def test_docker_sandbox_not_available():
    """测试 Docker 不可用时的错误处理"""
    docker_sandbox = DockerSandbox()
    
    # Mock _check_docker_available 方法返回 False
    async def mock_check_docker():
        return False
    
    docker_sandbox._check_docker_available = mock_check_docker
    
    result = await docker_sandbox.start(session_id="s1", data={"a": 1}, readonly=False)
    assert result["success"] is False
    assert "Docker is not available" in result["error"]


@pytest.mark.anyio
async def test_docker_sandbox_session_not_found():
    """测试会话不存在时的错误处理"""
    docker_sandbox = DockerSandbox()
    
    result = await docker_sandbox.exec("nonexistent", "echo hello")
    assert result["success"] is False
    assert "session not found" in result["error"].lower()


@pytest.mark.anyio
async def test_docker_sandbox_status_inactive():
    """测试查询不存在的会话状态"""
    docker_sandbox = DockerSandbox()
    
    status = await docker_sandbox.status("nonexistent")
    assert status["active"] is False


# ==================== 并行下载测试 ====================

@pytest.mark.anyio
async def test_parallel_download():
    """测试并行下载功能"""
    from src.sandbox.file_utils import download_files_parallel
    
    # 创建模拟 S3 服务
    mock_s3 = AsyncMock()
    mock_s3.download_file = AsyncMock(return_value=b"test content")
    mock_s3.get_file_metadata = AsyncMock(return_value=MagicMock(size=100))
    
    files = [
        {"path": "/workspace/file1.txt", "s3_key": "key1"},
        {"path": "/workspace/file2.txt", "s3_key": "key2"},
        {"path": "/workspace/file3.txt", "content": "direct content"},
    ]
    
    results = await download_files_parallel(files, mock_s3, max_concurrent=2)
    
    assert len(results) == 3
    
    # 验证 S3 下载被调用
    assert mock_s3.download_file.call_count == 2
    
    # 验证结果
    paths = [r[0] for r in results]
    assert "/workspace/file1.txt" in paths
    assert "/workspace/file2.txt" in paths
    assert "/workspace/file3.txt" in paths


@pytest.mark.anyio
async def test_prepare_files_for_sandbox():
    """测试准备沙盒文件"""
    from src.sandbox.file_utils import prepare_files_for_sandbox
    
    # 创建模拟 S3 服务
    mock_s3 = AsyncMock()
    mock_s3.download_file = AsyncMock(return_value=b"downloaded content")
    mock_s3.get_file_metadata = AsyncMock(return_value=MagicMock(size=100))
    
    files = [
        {"path": "/workspace/file1.txt", "content": "local content"},
        {"path": "/workspace/file2.txt", "s3_key": "key2"},
    ]
    
    prepared, failed = await prepare_files_for_sandbox(files, mock_s3)
    
    assert len(prepared) == 2
    assert len(failed) == 0
    
    # 验证内容
    file1 = next(f for f in prepared if f["path"] == "/workspace/file1.txt")
    assert file1["content"] == "local content"
    
    file2 = next(f for f in prepared if f["path"] == "/workspace/file2.txt")
    assert file2["content"] == b"downloaded content"


@pytest.mark.anyio
async def test_parallel_download_with_failures():
    """测试并行下载时部分失败"""
    from src.sandbox.file_utils import prepare_files_for_sandbox
    
    # 创建模拟 S3 服务，第二个文件下载失败
    mock_s3 = AsyncMock()
    mock_s3.download_file = AsyncMock(side_effect=[
        b"success content",
        Exception("S3 download failed"),
    ])
    mock_s3.get_file_metadata = AsyncMock(return_value=MagicMock(size=100))
    
    files = [
        {"path": "/workspace/file1.txt", "s3_key": "key1"},
        {"path": "/workspace/file2.txt", "s3_key": "key2"},
    ]
    
    prepared, failed = await prepare_files_for_sandbox(files, mock_s3)
    
    assert len(prepared) == 1
    assert len(failed) == 1
    assert failed[0]["path"] == "/workspace/file2.txt"
    assert "S3 download failed" in failed[0]["error"]
