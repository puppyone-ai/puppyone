import os
import uuid
import pytest


@pytest.mark.integration
@pytest.mark.asyncio
async def test_copy_resource_endpoint_success(api_client, tmp_storage_dir):
    """Test /files/copy_resource endpoint with valid auth"""
    os.environ["DEPLOYMENT_TYPE"] = "local"
    os.environ["LOCAL_STORAGE_PATH"] = str(tmp_storage_dir)
    os.environ["STRICT_LOCAL_AUTH"] = "false"  # Relaxed auth for test
    
    try:
        from utils.config import paths
        paths.STORAGE_ROOT = str(tmp_storage_dir)
    except Exception:
        pass
    
    from storage import reset_storage_manager, get_storage
    
    reset_storage_manager()
    adapter = get_storage()
    
    # Setup: Create source file
    user_id = "user123"
    source_key = f"template-official/block-{uuid.uuid4().hex}/v1"
    target_key = f"{user_id}/block-{uuid.uuid4().hex}/v1"
    
    adapter.save_file(source_key, b"template data", "text/plain")
    
    # Test: Call API endpoint
    response = await api_client.post(
        "/files/copy_resource",
        json={
            "source_key": source_key,
            "target_key": target_key
        },
        headers={"Authorization": "Bearer test-token"}
    )
    
    # Verify
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["target_key"] == target_key
    
    # Verify file copied
    assert adapter.check_file_exists(target_key)
    
    # Cleanup
    adapter.delete_file(source_key)
    adapter.delete_file(target_key)


@pytest.mark.integration
@pytest.mark.asyncio
async def test_copy_resource_endpoint_source_not_found(api_client, tmp_storage_dir):
    """Test endpoint returns 500 when source doesn't exist"""
    os.environ["DEPLOYMENT_TYPE"] = "local"
    os.environ["LOCAL_STORAGE_PATH"] = str(tmp_storage_dir)
    os.environ["STRICT_LOCAL_AUTH"] = "false"
    
    try:
        from utils.config import paths
        paths.STORAGE_ROOT = str(tmp_storage_dir)
    except Exception:
        pass
    
    from storage import reset_storage_manager
    reset_storage_manager()
    
    response = await api_client.post(
        "/files/copy_resource",
        json={
            "source_key": "nonexistent/block/v1",
            "target_key": "user123/block/v1"
        },
        headers={"Authorization": "Bearer test-token"}
    )
    
    assert response.status_code == 500
    assert "资源复制失败" in response.json().get("detail", "")


@pytest.mark.integration
@pytest.mark.asyncio
async def test_copy_resource_endpoint_auth_required(api_client):
    """Test endpoint requires authentication"""
    response = await api_client.post(
        "/files/copy_resource",
        json={
            "source_key": "template/block/v1",
            "target_key": "user123/block/v1"
        }
        # No Authorization header
    )
    
    # Should fail auth
    assert response.status_code in [401, 403]

