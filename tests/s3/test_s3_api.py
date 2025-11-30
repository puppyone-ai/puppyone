"""S3 存储模块集成测试

这些测试需要 LocalStack 运行在 localhost:4566
运行前确保:
1. LocalStack 已启动: localstack start
2. 已创建测试存储桶: awslocal s3api create-bucket --bucket contextbase
"""

import pytest
from httpx import AsyncClient, ASGITransport

from src.main import app


@pytest.fixture
async def client():
    """创建异步测试客户端"""
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as ac:
        yield ac


@pytest.mark.asyncio
async def test_upload_and_download_file(client: AsyncClient):
    """测试文件上传和下载"""
    # 上传文件
    test_content = b"Hello, S3!"
    test_key = "test/test_file.txt"

    files = {"file": ("test_file.txt", test_content, "text/plain")}
    data = {"key": test_key}

    upload_response = await client.post("/api/v1/s3/upload", files=files, data=data)
    assert upload_response.status_code == 201
    upload_data = upload_response.json()
    assert upload_data["key"] == test_key
    assert upload_data["size"] == len(test_content)

    # 下载文件
    download_response = await client.get(f"/api/v1/s3/download/{test_key}")
    assert download_response.status_code == 200
    assert download_response.content == test_content

    # 清理
    delete_response = await client.delete(f"/api/v1/s3/{test_key}")
    assert delete_response.status_code == 204


@pytest.mark.asyncio
async def test_file_exists(client: AsyncClient):
    """测试文件存在性检查"""
    test_key = "test/exists_test.txt"

    # 文件不存在
    response = await client.request("HEAD", f"/api/v1/s3/exists/{test_key}")
    assert response.status_code == 404

    # 上传文件
    files = {"file": ("test.txt", b"test", "text/plain")}
    data = {"key": test_key}
    await client.post("/api/v1/s3/upload", files=files, data=data)

    # 文件存在
    response = await client.request("HEAD", f"/api/v1/s3/exists/{test_key}")
    assert response.status_code == 200

    # 清理
    await client.delete(f"/api/v1/s3/{test_key}")


@pytest.mark.asyncio
async def test_list_files(client: AsyncClient):
    """测试文件列表"""
    # 上传测试文件
    test_prefix = "test/list_test/"
    test_files = [
        f"{test_prefix}file1.txt",
        f"{test_prefix}file2.txt",
        f"{test_prefix}subdir/file3.txt",
    ]

    for key in test_files:
        files = {"file": ("test.txt", b"test content", "text/plain")}
        data = {"key": key}
        await client.post("/api/v1/s3/upload", files=files, data=data)

    # 列出文件
    response = await client.get(
        "/api/v1/s3/list", params={"prefix": test_prefix, "max_keys": 10}
    )
    assert response.status_code == 200
    data = response.json()
    assert len(data["files"]) == 3

    # 清理
    for key in test_files:
        await client.delete(f"/api/v1/s3/{key}")


@pytest.mark.asyncio
async def test_file_metadata(client: AsyncClient):
    """测试获取文件元信息"""
    test_key = "test/metadata_test.txt"
    test_content = b"Metadata test content"

    # 上传文件
    files = {"file": ("test.txt", test_content, "text/plain")}
    data = {"key": test_key, "content_type": "text/plain"}
    await client.post("/api/v1/s3/upload", files=files, data=data)

    # 获取元信息
    response = await client.get(f"/api/v1/s3/metadata/{test_key}")
    assert response.status_code == 200
    metadata = response.json()
    assert metadata["key"] == test_key
    assert metadata["size"] == len(test_content)
    assert metadata["content_type"] == "text/plain"

    # 清理
    await client.delete(f"/api/v1/s3/{test_key}")


@pytest.mark.asyncio
async def test_batch_delete(client: AsyncClient):
    """测试批量删除"""
    # 上传多个文件
    test_keys = [
        "test/batch/file1.txt",
        "test/batch/file2.txt",
        "test/batch/file3.txt",
    ]

    for key in test_keys:
        files = {"file": ("test.txt", b"test", "text/plain")}
        data = {"key": key}
        await client.post("/api/v1/s3/upload", files=files, data=data)

    # 批量删除
    response = await client.post("/api/v1/s3/delete/batch", json={"keys": test_keys})
    assert response.status_code == 200
    data = response.json()
    assert data["total"] == 3
    assert data["successful"] == 3


@pytest.mark.asyncio
async def test_file_size_limit(client: AsyncClient):
    """测试文件大小限制"""
    # 创建超过限制的文件 (假设限制是 100MB)
    # 这里我们只测试小于限制的情况,超限测试需要调整配置
    test_content = b"x" * (1024 * 1024)  # 1MB
    test_key = "test/size_test.txt"

    files = {"file": ("large.txt", test_content, "text/plain")}
    data = {"key": test_key}

    response = await client.post("/api/v1/s3/upload", files=files, data=data)
    assert response.status_code == 201

    # 清理
    await client.delete(f"/api/v1/s3/{test_key}")


@pytest.mark.asyncio
async def test_presigned_urls(client: AsyncClient):
    """测试预签名 URL 生成"""
    test_key = "test/presigned_test.txt"

    # 生成上传预签名 URL
    upload_request = {"key": test_key, "expires_in": 3600}
    response = await client.post("/api/v1/s3/presigned-url/upload", json=upload_request)
    assert response.status_code == 200
    upload_data = response.json()
    assert "url" in upload_data
    assert upload_data["key"] == test_key

    # 上传文件以便测试下载 URL
    files = {"file": ("test.txt", b"test content", "text/plain")}
    data = {"key": test_key}
    await client.post("/api/v1/s3/upload", files=files, data=data)

    # 生成下载预签名 URL
    download_request = {"key": test_key, "expires_in": 3600}
    response = await client.post(
        "/api/v1/s3/presigned-url/download", json=download_request
    )
    assert response.status_code == 200
    download_data = response.json()
    assert "url" in download_data
    assert download_data["key"] == test_key

    # 清理
    await client.delete(f"/api/v1/s3/{test_key}")
