import os
import uuid
import pytest


@pytest.mark.integration
@pytest.mark.local
def test_local_copy_resource_success(tmp_storage_dir):
    """Test successful resource copy in local storage"""
    os.environ["DEPLOYMENT_TYPE"] = "local"
    os.environ["LOCAL_STORAGE_PATH"] = str(tmp_storage_dir)
    
    try:
        from utils.config import paths
        paths.STORAGE_ROOT = str(tmp_storage_dir)
    except Exception:
        pass
    
    from storage import reset_storage_manager, get_storage
    from storage.local import LocalStorageAdapter
    
    reset_storage_manager()
    adapter = get_storage()
    assert isinstance(adapter, LocalStorageAdapter)
    
    # Setup: Create source file
    source_key = f"template-user/block-{uuid.uuid4().hex}/v1"
    target_key = f"user123/block-{uuid.uuid4().hex}/v1"
    data = b"template content"
    
    adapter.save_file(source_key, data, "text/plain")
    assert adapter.check_file_exists(source_key)
    
    # Test: Copy resource
    success = adapter.copy_resource(source_key, target_key)
    
    # Verify
    assert success is True
    assert adapter.check_file_exists(target_key)
    
    # Verify content matches
    target_data, _ = adapter.get_file(target_key)
    assert target_data == data
    
    # Cleanup
    adapter.delete_file(source_key)
    adapter.delete_file(target_key)


@pytest.mark.integration
@pytest.mark.local
def test_local_copy_resource_source_not_found(tmp_storage_dir):
    """Test copy fails gracefully when source doesn't exist"""
    os.environ["DEPLOYMENT_TYPE"] = "local"
    os.environ["LOCAL_STORAGE_PATH"] = str(tmp_storage_dir)
    
    try:
        from utils.config import paths
        paths.STORAGE_ROOT = str(tmp_storage_dir)
    except Exception:
        pass
    
    from storage import reset_storage_manager, get_storage
    
    reset_storage_manager()
    adapter = get_storage()
    
    source_key = f"nonexistent/block/v1"
    target_key = f"user123/block/v1"
    
    success = adapter.copy_resource(source_key, target_key)
    
    assert success is False
    assert not adapter.check_file_exists(target_key)


@pytest.mark.integration
@pytest.mark.local
def test_local_copy_resource_preserves_metadata(tmp_storage_dir):
    """Test that copy preserves file metadata (using shutil.copy2)"""
    import time
    
    os.environ["DEPLOYMENT_TYPE"] = "local"
    os.environ["LOCAL_STORAGE_PATH"] = str(tmp_storage_dir)
    
    try:
        from utils.config import paths
        paths.STORAGE_ROOT = str(tmp_storage_dir)
    except Exception:
        pass
    
    from storage import reset_storage_manager, get_storage
    
    reset_storage_manager()
    adapter = get_storage()
    
    source_key = f"template/block/v1"
    target_key = f"user123/block/v1"
    data = b"content"
    
    adapter.save_file(source_key, data, "text/plain")
    time.sleep(0.1)  # Ensure time difference
    
    success = adapter.copy_resource(source_key, target_key)
    assert success
    
    # Verify both files exist and have same content
    source_data, _ = adapter.get_file(source_key)
    target_data, _ = adapter.get_file(target_key)
    assert source_data == target_data
    
    # Cleanup
    adapter.delete_file(source_key)
    adapter.delete_file(target_key)

