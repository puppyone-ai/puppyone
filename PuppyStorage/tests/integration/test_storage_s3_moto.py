import os
import uuid
import pytest


@pytest.mark.integration
@pytest.mark.s3
def test_s3_storage_crud_with_moto(s3_moto):
    # Switch to remote (S3) and feed env for S3 adapter
    os.environ["DEPLOYMENT_TYPE"] = "remote"
    os.environ["CLOUDFLARE_R2_BUCKET"] = s3_moto["bucket"]
    # Leave endpoint unset; moto intercepts default boto3 calls

    from storage import reset_storage_manager, get_storage
    from storage.S3 import S3StorageAdapter

    reset_storage_manager()
    adapter = get_storage()
    assert isinstance(adapter, S3StorageAdapter)

    # Force adapter to use moto's client to avoid any external endpoints
    adapter.s3_client = s3_moto["client"]

    prefix = f"test/{uuid.uuid4().hex}"
    key = f"{prefix}/demo.txt"
    data = b"world"
    content_type = "text/plain"

    # Create
    ok = adapter.save_file(key, data, content_type)
    assert ok
    assert adapter.check_file_exists(key)

    # Read
    got, got_type = adapter.get_file(key)
    assert got == data
    assert got_type == content_type

    # List
    listed = adapter.list_objects(prefix=prefix)
    # moto returns 'key' for our wrapper
    assert any(obj.get("key", "").endswith("demo.txt") for obj in listed)

    # Delete
    assert adapter.delete_file(key)
    assert not adapter.check_file_exists(key)


@pytest.mark.integration
@pytest.mark.s3
def test_s3_list_and_idempotent_delete(s3_moto):
    os.environ["DEPLOYMENT_TYPE"] = "remote"
    os.environ["CLOUDFLARE_R2_BUCKET"] = s3_moto["bucket"]

    from storage import reset_storage_manager, get_storage
    from storage.S3 import S3StorageAdapter

    reset_storage_manager()
    adapter = get_storage()
    assert isinstance(adapter, S3StorageAdapter)

    # Force moto client
    adapter.s3_client = s3_moto["client"]

    # Create a couple objects
    adapter.save_file("u1/a.txt", b"1", "text/plain")
    adapter.save_file("u1/b.txt", b"2", "text/plain")

    listed = adapter.list_objects(prefix="u1/")
    keys = [i.get("key") for i in listed if "key" in i]
    assert any(k.endswith("a.txt") for k in keys)
    assert any(k.endswith("b.txt") for k in keys)

    # Idempotent delete
    assert adapter.delete_file("u1/a.txt") in (True, False)
    assert adapter.delete_file("u1/a.txt") in (True, False)


@pytest.mark.integration
@pytest.mark.s3
def test_s3_error_paths_and_largeish(s3_moto):
    os.environ["DEPLOYMENT_TYPE"] = "remote"
    os.environ["CLOUDFLARE_R2_BUCKET"] = s3_moto["bucket"]

    from storage import reset_storage_manager, get_storage
    from storage.S3 import S3StorageAdapter

    reset_storage_manager()
    adapter = get_storage()
    assert isinstance(adapter, S3StorageAdapter)

    adapter.s3_client = s3_moto["client"]

    # Large-ish file (~1MB) to speed up CI
    key = "u1/large.bin"
    payload = b"B" * (1024 * 1024)
    assert adapter.save_file(key, payload, "application/octet-stream")
    data, ctype = adapter.get_file(key)
    assert data == payload and ctype == "application/octet-stream"

    # Nonexistent get returns (None, None)
    d2, t2 = adapter.get_file("u1/not-exist.bin")
    assert d2 is None and t2 is None


@pytest.mark.integration
@pytest.mark.s3
def test_s3_presigned_urls(s3_moto):
    """Test presigned URL generation"""
    os.environ["DEPLOYMENT_TYPE"] = "remote"
    os.environ["CLOUDFLARE_R2_BUCKET"] = s3_moto["bucket"]

    from storage import reset_storage_manager, get_storage
    from storage.S3 import S3StorageAdapter

    reset_storage_manager()
    adapter = get_storage()
    assert isinstance(adapter, S3StorageAdapter)
    adapter.s3_client = s3_moto["client"]
    adapter.s3_presigned_client = s3_moto["client"]

    key = "test/presigned.txt"

    # Test generate_upload_url
    upload_url = adapter.generate_upload_url(key, "text/plain", expires_in=300)
    assert upload_url
    assert key in upload_url
    
    # Test generate_download_url
    adapter.save_file(key, b"test data", "text/plain")
    download_url = adapter.generate_download_url(key, expires_in=3600)
    assert download_url
    assert key in download_url
    
    # Test generate_delete_url
    delete_url = adapter.generate_delete_url(key, expires_in=300)
    assert delete_url
    assert key in delete_url
    
    # Test get_download_url (wrapper with expires_at)
    result = adapter.get_download_url(key, expires_in=1800)
    assert "download_url" in result
    assert "key" in result
    assert result["key"] == key
    assert "expires_at" in result
    assert result["expires_at"] > 0


@pytest.mark.integration
@pytest.mark.s3
def test_s3_file_with_metadata(s3_moto):
    """Test get_file_with_metadata"""
    os.environ["DEPLOYMENT_TYPE"] = "remote"
    os.environ["CLOUDFLARE_R2_BUCKET"] = s3_moto["bucket"]

    from storage import reset_storage_manager, get_storage
    from storage.S3 import S3StorageAdapter

    reset_storage_manager()
    adapter = get_storage()
    assert isinstance(adapter, S3StorageAdapter)
    adapter.s3_client = s3_moto["client"]

    key = "test/metadata.txt"
    data = b"test data with metadata"
    
    # Save file
    adapter.save_file(key, data, "text/plain")
    
    # Get file with metadata
    content, content_type, etag = adapter.get_file_with_metadata(key)
    assert content == data
    assert content_type == "text/plain"
    assert etag  # ETag should be present
    
    # Test non-existent file - should raise FileNotFoundError
    from storage.exceptions import FileNotFoundError as StorageFileNotFoundError
    try:
        content2, ctype2, etag2 = adapter.get_file_with_metadata("nonexistent.txt")
        assert False, "Should have raised FileNotFoundError"
    except (StorageFileNotFoundError, FileNotFoundError):
        # Expected behavior
        pass


@pytest.mark.integration
@pytest.mark.s3
def test_s3_multipart_upload(s3_moto):
    """Test multipart upload operations"""
    os.environ["DEPLOYMENT_TYPE"] = "remote"
    os.environ["CLOUDFLARE_R2_BUCKET"] = s3_moto["bucket"]

    from storage import reset_storage_manager, get_storage
    from storage.S3 import S3StorageAdapter

    reset_storage_manager()
    adapter = get_storage()
    assert isinstance(adapter, S3StorageAdapter)
    adapter.s3_client = s3_moto["client"]
    adapter.s3_presigned_client = s3_moto["client"]

    key = "test/multipart.bin"
    
    # 1. Initialize multipart upload
    init_result = adapter.init_multipart_upload(key, "application/octet-stream")
    assert "upload_id" in init_result
    assert "key" in init_result
    upload_id = init_result["upload_id"]
    
    # 2. Get presigned URL for part upload
    part_result = adapter.get_multipart_upload_url(key, upload_id, part_number=1, expires_in=300)
    assert "upload_url" in part_result
    assert "part_number" in part_result
    assert part_result["part_number"] == 1
    
    # 3. List multipart uploads
    uploads = adapter.list_multipart_uploads(prefix="test/")
    assert isinstance(uploads, list)
    # Should find our upload
    assert any(u.get("key") == key for u in uploads)
    
    # 4. Abort multipart upload (cleanup)
    abort_result = adapter.abort_multipart_upload(key, upload_id)
    assert "success" in abort_result
    assert abort_result["success"] is True


@pytest.mark.integration
@pytest.mark.s3  
def test_s3_multipart_complete(s3_moto):
    """Test completing a multipart upload"""
    os.environ["DEPLOYMENT_TYPE"] = "remote"
    os.environ["CLOUDFLARE_R2_BUCKET"] = s3_moto["bucket"]

    from storage import reset_storage_manager, get_storage
    from storage.S3 import S3StorageAdapter

    reset_storage_manager()
    adapter = get_storage()
    assert isinstance(adapter, S3StorageAdapter)
    adapter.s3_client = s3_moto["client"]
    adapter.s3_presigned_client = s3_moto["client"]

    key = "test/multipart_complete.bin"
    
    # Initialize
    init_result = adapter.init_multipart_upload(key, "application/octet-stream")
    upload_id = init_result["upload_id"]
    
    # Upload a part directly (moto allows this)
    part_data = b"X" * 1024
    response = adapter.s3_client.upload_part(
        Bucket=s3_moto["bucket"],
        Key=key,
        PartNumber=1,
        UploadId=upload_id,
        Body=part_data
    )
    etag = response["ETag"]
    
    # Complete multipart upload
    parts = [{"PartNumber": 1, "ETag": etag}]
    complete_result = adapter.complete_multipart_upload(key, upload_id, parts)
    assert "success" in complete_result
    assert complete_result["success"] is True
    
    # Verify file was created
    assert adapter.check_file_exists(key)
    content, _ = adapter.get_file(key)
    assert content == part_data


@pytest.mark.integration
@pytest.mark.s3
def test_s3_ping_health_check(s3_moto):
    """Test S3 ping health check"""
    os.environ["DEPLOYMENT_TYPE"] = "remote"
    os.environ["CLOUDFLARE_R2_BUCKET"] = s3_moto["bucket"]

    from storage import reset_storage_manager, get_storage
    from storage.S3 import S3StorageAdapter

    reset_storage_manager()
    adapter = get_storage()
    assert isinstance(adapter, S3StorageAdapter)
    adapter.s3_client = s3_moto["client"]

    # Test ping
    result = adapter.ping()
    assert result["ok"] is True
    assert result["type"] == "s3"
    assert result["bucket"] == s3_moto["bucket"]


@pytest.mark.integration
@pytest.mark.s3
def test_s3_save_chunk_direct(s3_moto):
    """Test save_chunk_direct method on S3 adapter - regression test for production bug"""
    os.environ["DEPLOYMENT_TYPE"] = "remote"
    os.environ["CLOUDFLARE_R2_BUCKET"] = s3_moto["bucket"]

    from storage import reset_storage_manager, get_storage
    from storage.S3 import S3StorageAdapter

    reset_storage_manager()
    adapter = get_storage()
    assert isinstance(adapter, S3StorageAdapter)
    adapter.s3_client = s3_moto["client"]

    key = "test/direct_chunk.bin"
    chunk_data = b"Test chunk data for direct upload"
    content_type = "application/octet-stream"
    
    # Verify the method exists
    assert hasattr(adapter, 'save_chunk_direct'), "S3StorageAdapter missing save_chunk_direct method"
    
    # Test save_chunk_direct
    result = adapter.save_chunk_direct(key, chunk_data, content_type)
    
    assert result["success"] is True
    assert result["key"] == key
    assert result["size"] == len(chunk_data)
    assert "etag" in result
    assert result["etag"]  # ETag should not be empty
    assert "uploaded_at" in result
    assert result["uploaded_at"] > 0
    
    # Verify file was created and content is correct
    assert adapter.check_file_exists(key)
    content, ctype = adapter.get_file(key)
    assert content == chunk_data
    assert ctype == content_type


