import os
import uuid
import pytest


@pytest.mark.integration
@pytest.mark.s3
def test_s3_copy_resource_success(s3_moto):
    """Test successful resource copy in S3 storage (moto)"""
    os.environ["DEPLOYMENT_TYPE"] = "remote"
    os.environ["CLOUDFLARE_R2_BUCKET"] = s3_moto["bucket"]
    
    from storage import reset_storage_manager, get_storage
    from storage.S3 import S3StorageAdapter
    
    reset_storage_manager()
    adapter = get_storage()
    assert isinstance(adapter, S3StorageAdapter)
    
    # Use moto client
    adapter.s3_client = s3_moto["client"]
    
    # Setup
    source_key = f"template-official/block-{uuid.uuid4().hex}/v1"
    target_key = f"user456/block-{uuid.uuid4().hex}/v1"
    data = b"s3 template content"
    
    adapter.save_file(source_key, data, "text/plain")
    
    # Test copy
    success = adapter.copy_resource(source_key, target_key)
    
    # Verify
    assert success is True
    assert adapter.check_file_exists(target_key)
    
    target_data, _ = adapter.get_file(target_key)
    assert target_data == data
    
    # Cleanup
    adapter.delete_file(source_key)
    adapter.delete_file(target_key)


@pytest.mark.integration
@pytest.mark.s3
def test_s3_copy_resource_server_side(s3_moto):
    """Verify S3 copy uses server-side operation (no data transfer)"""
    os.environ["DEPLOYMENT_TYPE"] = "remote"
    os.environ["CLOUDFLARE_R2_BUCKET"] = s3_moto["bucket"]
    
    from storage import reset_storage_manager, get_storage
    from storage.S3 import S3StorageAdapter
    
    reset_storage_manager()
    adapter = get_storage()
    adapter.s3_client = s3_moto["client"]
    
    # Large file (1MB)
    source_key = f"template/large-file/v1"
    target_key = f"user789/large-file/v1"
    data = b"x" * (1024 * 1024)
    
    adapter.save_file(source_key, data, "application/octet-stream")
    
    import time
    start = time.time()
    success = adapter.copy_resource(source_key, target_key)
    elapsed = time.time() - start
    
    assert success
    # Server-side copy should be fast even for large files
    assert elapsed < 1.0, f"Copy too slow: {elapsed:.3f}s (should use server-side copy)"
    
    # Verify integrity
    target_data, _ = adapter.get_file(target_key)
    assert len(target_data) == len(data)
    
    # Cleanup
    adapter.delete_file(source_key)
    adapter.delete_file(target_key)

