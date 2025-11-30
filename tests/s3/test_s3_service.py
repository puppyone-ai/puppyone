"""S3 Service 单元测试 - 使用 moto 模拟 S3"""

import pytest
from moto import mock_aws

from src.s3.exceptions import (
    S3FileNotFoundError,
    S3FileSizeExceededError,
)
from src.s3.service import S3Service


@pytest.fixture
def s3_service():
    """创建 S3 服务实例并初始化 mock"""
    with mock_aws():
        service = S3Service()
        # 创建测试桶
        service.client.create_bucket(Bucket=service.bucket_name)
        yield service


# ============= 文件上传测试 =============


@pytest.mark.asyncio
async def test_upload_file_success(s3_service):
    """测试文件上传成功"""
    key = "test/upload_test.txt"
    content = b"Hello, S3!"
    content_type = "text/plain"

    result = await s3_service.upload_file(
        key=key, content=content, content_type=content_type
    )

    assert result.key == key
    assert result.bucket == s3_service.bucket_name
    assert result.size == len(content)
    assert result.etag is not None
    assert result.content_type == content_type


@pytest.mark.asyncio
async def test_upload_file_with_metadata(s3_service):
    """测试带元数据的文件上传"""
    key = "test/metadata_upload.txt"
    content = b"Test content"
    metadata = {"custom-key": "custom-value", "author": "test-user"}

    result = await s3_service.upload_file(key=key, content=content, metadata=metadata)

    assert result.key == key
    assert result.size == len(content)

    # 验证元数据（注意：S3 会将元数据键转换为首字母大写）
    file_metadata = await s3_service.get_file_metadata(key)
    # 将返回的元数据键转换为小写进行比较
    returned_metadata_lowercase = {
        k.lower(): v for k, v in file_metadata.metadata.items()
    }
    assert returned_metadata_lowercase == metadata


@pytest.mark.asyncio
async def test_upload_file_size_exceeded(s3_service):
    """测试文件大小超限"""
    key = "test/large_file.txt"
    # 创建超过限制的内容
    content = b"x" * (s3_service.max_file_size + 1)

    with pytest.raises(S3FileSizeExceededError) as exc_info:
        await s3_service.upload_file(key=key, content=content)

    assert exc_info.value.size == len(content)
    assert exc_info.value.max_size == s3_service.max_file_size


@pytest.mark.asyncio
async def test_upload_files_batch_success(s3_service):
    """测试批量文件上传成功"""
    files = [
        ("test/batch1.txt", b"content1", "text/plain"),
        ("test/batch2.txt", b"content2", "text/plain"),
        ("test/batch3.txt", b"content3", "text/plain"),
    ]

    results = await s3_service.upload_files_batch(files)

    assert len(results) == 3
    for key, success, message, response in results:
        assert success is True
        assert message is None
        assert response is not None
        assert response.key in [f[0] for f in files]


@pytest.mark.asyncio
async def test_upload_files_batch_partial_failure(s3_service):
    """测试批量上传部分失败"""
    # 包含一个大小超限的文件
    files = [
        ("test/batch1.txt", b"content1", "text/plain"),
        ("test/batch_large.txt", b"x" * (s3_service.max_file_size + 1), "text/plain"),
        ("test/batch3.txt", b"content3", "text/plain"),
    ]

    results = await s3_service.upload_files_batch(files)

    assert len(results) == 3
    assert results[0][1] is True  # 第一个成功
    assert results[1][1] is False  # 第二个失败（大小超限）
    assert results[2][1] is True  # 第三个成功


# ============= 文件下载测试 =============


@pytest.mark.asyncio
async def test_download_file_stream(s3_service):
    """测试流式下载文件"""
    key = "test/download_test.txt"
    content = b"Download test content"

    # 先上传文件
    await s3_service.upload_file(key=key, content=content)

    # 流式下载
    downloaded_content = b""
    async for chunk in s3_service.download_file_stream(key):
        downloaded_content += chunk

    assert downloaded_content == content


@pytest.mark.asyncio
async def test_download_file_stream_not_found(s3_service):
    """测试下载不存在的文件"""
    key = "test/nonexistent.txt"

    with pytest.raises(S3FileNotFoundError):
        async for _ in s3_service.download_file_stream(key):
            pass


@pytest.mark.asyncio
async def test_download_file_stream_with_custom_chunk_size(s3_service):
    """测试自定义块大小的流式下载"""
    key = "test/chunked_download.txt"
    content = b"x" * 1024  # 1KB

    await s3_service.upload_file(key=key, content=content)

    # 使用小块大小下载
    chunks = []
    async for chunk in s3_service.download_file_stream(key, chunk_size=256):
        chunks.append(chunk)

    # 验证分块下载
    assert len(chunks) > 1
    assert b"".join(chunks) == content


# ============= 文件存在性检查测试 =============


@pytest.mark.asyncio
async def test_file_exists_true(s3_service):
    """测试文件存在"""
    key = "test/exists.txt"
    await s3_service.upload_file(key=key, content=b"test")

    exists = await s3_service.file_exists(key)
    assert exists is True


@pytest.mark.asyncio
async def test_file_exists_false(s3_service):
    """测试文件不存在"""
    key = "test/nonexistent.txt"

    exists = await s3_service.file_exists(key)
    assert exists is False


# ============= 文件删除测试 =============


@pytest.mark.asyncio
async def test_delete_file_success(s3_service):
    """测试删除文件成功"""
    key = "test/delete_test.txt"
    await s3_service.upload_file(key=key, content=b"test")

    # 删除文件
    await s3_service.delete_file(key)

    # 验证文件已删除
    exists = await s3_service.file_exists(key)
    assert exists is False


@pytest.mark.asyncio
async def test_delete_file_not_found(s3_service):
    """测试删除不存在的文件"""
    key = "test/nonexistent.txt"

    with pytest.raises(S3FileNotFoundError):
        await s3_service.delete_file(key)


@pytest.mark.asyncio
async def test_delete_files_batch_success(s3_service):
    """测试批量删除成功"""
    keys = [
        "test/batch_delete1.txt",
        "test/batch_delete2.txt",
        "test/batch_delete3.txt",
    ]

    # 上传文件
    for key in keys:
        await s3_service.upload_file(key=key, content=b"test")

    # 批量删除
    results = await s3_service.delete_files_batch(keys)

    assert len(results) == 3
    for result in results:
        assert result.success is True
        assert result.message is None


@pytest.mark.asyncio
async def test_delete_files_batch_partial_failure(s3_service):
    """测试批量删除部分失败"""
    keys = [
        "test/batch_delete1.txt",
        "test/nonexistent.txt",  # 不存在
        "test/batch_delete3.txt",
    ]

    # 上传存在的文件
    await s3_service.upload_file(key=keys[0], content=b"test")
    await s3_service.upload_file(key=keys[2], content=b"test")

    # 批量删除
    results = await s3_service.delete_files_batch(keys)

    assert len(results) == 3
    assert results[0].success is True
    assert results[1].success is False  # 不存在
    assert results[2].success is True


# ============= 文件列表测试 =============


@pytest.mark.asyncio
async def test_list_files_empty(s3_service):
    """测试列出空文件列表"""
    files, prefixes, next_token, is_truncated = await s3_service.list_files(
        prefix="test/empty/"
    )

    assert len(files) == 0
    assert len(prefixes) == 0
    assert next_token is None
    assert is_truncated is False


@pytest.mark.asyncio
async def test_list_files_with_prefix(s3_service):
    """测试带前缀的文件列表"""
    prefix = "test/list/"
    keys = [
        f"{prefix}file1.txt",
        f"{prefix}file2.txt",
        f"{prefix}file3.txt",
    ]

    # 上传文件
    for key in keys:
        await s3_service.upload_file(key=key, content=b"test")

    # 列出文件
    files, prefixes, next_token, is_truncated = await s3_service.list_files(
        prefix=prefix
    )

    assert len(files) == 3
    assert all(f.key.startswith(prefix) for f in files)


@pytest.mark.asyncio
async def test_list_files_with_delimiter(s3_service):
    """测试使用分隔符列出文件（模拟文件夹）"""
    # 创建多级目录结构
    keys = [
        "test/dir/file1.txt",
        "test/dir/file2.txt",
        "test/dir/subdir/file3.txt",
    ]

    for key in keys:
        await s3_service.upload_file(key=key, content=b"test")

    # 使用分隔符列出
    files, prefixes, next_token, is_truncated = await s3_service.list_files(
        prefix="test/dir/", delimiter="/"
    )

    assert len(files) == 2  # file1.txt 和 file2.txt
    assert len(prefixes) == 1  # subdir/
    assert "test/dir/subdir/" in prefixes


@pytest.mark.asyncio
async def test_list_files_with_max_keys(s3_service):
    """测试限制返回数量"""
    prefix = "test/maxkeys/"

    # 上传 10 个文件
    for i in range(10):
        await s3_service.upload_file(key=f"{prefix}file{i}.txt", content=b"test")

    # 限制返回 5 个
    files, prefixes, next_token, is_truncated = await s3_service.list_files(
        prefix=prefix, max_keys=5
    )

    assert len(files) == 5
    # 注意: moto 可能不完全模拟分页行为，这里主要测试参数传递


# ============= 文件元信息测试 =============


@pytest.mark.asyncio
async def test_get_file_metadata_success(s3_service):
    """测试获取文件元信息"""
    key = "test/metadata.txt"
    content = b"Metadata test"
    content_type = "text/plain"

    await s3_service.upload_file(key=key, content=content, content_type=content_type)

    metadata = await s3_service.get_file_metadata(key)

    assert metadata.key == key
    assert metadata.bucket == s3_service.bucket_name
    assert metadata.size == len(content)
    assert metadata.etag is not None
    assert metadata.last_modified is not None
    assert metadata.content_type == content_type


@pytest.mark.asyncio
async def test_get_file_metadata_not_found(s3_service):
    """测试获取不存在文件的元信息"""
    key = "test/nonexistent.txt"

    with pytest.raises(S3FileNotFoundError):
        await s3_service.get_file_metadata(key)


# ============= 预签名 URL 测试 =============


@pytest.mark.asyncio
async def test_generate_presigned_upload_url(s3_service):
    """测试生成上传预签名 URL"""
    key = "test/presigned_upload.txt"
    expires_in = 3600

    url = await s3_service.generate_presigned_upload_url(key=key, expires_in=expires_in)

    assert url is not None
    assert isinstance(url, str)
    assert key in url
    assert "AWSAccessKeyId" in url or "X-Amz-Credential" in url


@pytest.mark.asyncio
async def test_generate_presigned_upload_url_with_content_type(s3_service):
    """测试带 content_type 的上传预签名 URL"""
    key = "test/presigned_upload_typed.txt"
    content_type = "text/plain"

    url = await s3_service.generate_presigned_upload_url(
        key=key, expires_in=3600, content_type=content_type
    )

    assert url is not None
    assert key in url


@pytest.mark.asyncio
async def test_generate_presigned_download_url(s3_service):
    """测试生成下载预签名 URL"""
    key = "test/presigned_download.txt"

    # 先上传文件
    await s3_service.upload_file(key=key, content=b"test")

    url = await s3_service.generate_presigned_download_url(key=key, expires_in=3600)

    assert url is not None
    assert isinstance(url, str)
    assert key in url


@pytest.mark.asyncio
async def test_generate_presigned_download_url_with_disposition(s3_service):
    """测试带 Content-Disposition 的下载预签名 URL"""
    key = "test/presigned_download_disposition.txt"

    await s3_service.upload_file(key=key, content=b"test")

    url = await s3_service.generate_presigned_download_url(
        key=key,
        expires_in=3600,
        response_content_disposition='attachment; filename="custom.txt"',
    )

    assert url is not None
    assert key in url
    assert "response-content-disposition" in url


# ============= 分片上传测试 =============


@pytest.mark.asyncio
async def test_multipart_upload_complete_flow(s3_service):
    """测试完整的分片上传流程"""
    key = "test/multipart_complete.txt"

    # 1. 创建分片上传
    upload_id = await s3_service.create_multipart_upload(
        key=key, content_type="text/plain"
    )
    assert upload_id is not None

    # 2. 上传分片
    part1_data = b"x" * (5 * 1024 * 1024)  # 5MB
    part2_data = b"y" * (5 * 1024 * 1024)  # 5MB

    etag1 = await s3_service.upload_part(
        key=key, upload_id=upload_id, part_number=1, data=part1_data
    )
    etag2 = await s3_service.upload_part(
        key=key, upload_id=upload_id, part_number=2, data=part2_data
    )

    assert etag1 is not None
    assert etag2 is not None

    # 3. 完成分片上传
    parts = [(1, etag1), (2, etag2)]
    result = await s3_service.complete_multipart_upload(
        key=key, upload_id=upload_id, parts=parts
    )

    assert result.key == key
    assert result.bucket == s3_service.bucket_name
    assert result.etag is not None

    # 4. 验证文件已上传
    exists = await s3_service.file_exists(key)
    assert exists is True


@pytest.mark.asyncio
async def test_multipart_upload_abort(s3_service):
    """测试取消分片上传"""
    key = "test/multipart_abort.txt"

    # 创建分片上传
    upload_id = await s3_service.create_multipart_upload(key=key)

    # 上传一个分片
    part_data = b"x" * (5 * 1024 * 1024)
    await s3_service.upload_part(
        key=key, upload_id=upload_id, part_number=1, data=part_data
    )

    # 取消上传
    await s3_service.abort_multipart_upload(key=key, upload_id=upload_id)

    # 验证文件未创建
    exists = await s3_service.file_exists(key)
    assert exists is False


@pytest.mark.asyncio
async def test_list_multipart_uploads(s3_service):
    """测试列出进行中的分片上传"""
    key = "test/multipart_list.txt"

    # 创建分片上传
    upload_id = await s3_service.create_multipart_upload(key=key)

    # 列出进行中的上传
    uploads, next_token = await s3_service.list_multipart_uploads()

    assert len(uploads) >= 1
    assert any(u.key == key and u.upload_id == upload_id for u in uploads)

    # 清理
    await s3_service.abort_multipart_upload(key=key, upload_id=upload_id)


@pytest.mark.asyncio
async def test_list_parts(s3_service):
    """测试列出已上传的分片"""
    key = "test/multipart_list_parts.txt"

    # 创建分片上传
    upload_id = await s3_service.create_multipart_upload(key=key)

    # 上传两个分片
    part1_data = b"x" * (5 * 1024 * 1024)
    part2_data = b"y" * (5 * 1024 * 1024)

    await s3_service.upload_part(
        key=key, upload_id=upload_id, part_number=1, data=part1_data
    )
    await s3_service.upload_part(
        key=key, upload_id=upload_id, part_number=2, data=part2_data
    )

    # 列出分片
    parts, next_marker = await s3_service.list_parts(key=key, upload_id=upload_id)

    assert len(parts) == 2
    assert parts[0].part_number == 1
    assert parts[1].part_number == 2
    assert parts[0].size == len(part1_data)
    assert parts[1].size == len(part2_data)

    # 清理
    await s3_service.abort_multipart_upload(key=key, upload_id=upload_id)


# ============= 错误处理测试 =============


@pytest.mark.asyncio
async def test_error_handling_invalid_bucket(s3_service):
    """测试错误的桶名称处理"""
    # 修改桶名称为不存在的桶
    original_bucket = s3_service.bucket_name
    s3_service.bucket_name = "nonexistent-bucket"

    try:
        with pytest.raises(Exception):  # 应该抛出异常
            await s3_service.upload_file(key="test/error.txt", content=b"test")
    finally:
        s3_service.bucket_name = original_bucket
