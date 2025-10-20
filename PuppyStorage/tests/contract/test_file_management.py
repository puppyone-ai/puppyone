"""
Contract tests for file management operations (delete)
"""

import pytest
from fastapi.testclient import TestClient
from server.storage_server import app
from storage import get_storage, reset_storage_manager
import os
import tempfile
import shutil


@pytest.fixture(scope="function")
def test_client():
    """Create test client"""
    return TestClient(app)


@pytest.fixture(scope="function")
def temp_storage_dir():
    """Create temporary storage directory"""
    temp_dir = tempfile.mkdtemp()
    os.environ["DEPLOYMENT_TYPE"] = "local"
    os.environ["LOCAL_STORAGE_BASE_PATH"] = temp_dir
    
    # Reset storage manager to pick up new config
    reset_storage_manager()
    
    yield temp_dir
    
    # Cleanup
    if os.path.exists(temp_dir):
        shutil.rmtree(temp_dir)
    reset_storage_manager()


@pytest.fixture
def mock_jwt_token():
    """Mock JWT token for testing"""
    return "Bearer mock_jwt_token_for_testing"


@pytest.fixture
def setup_test_file(temp_storage_dir):
    """Setup a test file for deletion"""
    storage = get_storage()
    
    # Create a test file
    user_id = "test_user"
    resource_key = f"{user_id}/test_block/v1/test_file.txt"
    test_content = b"Test file content for deletion"
    
    # Upload the file
    storage.upload_file(resource_key, test_content)
    
    return {
        "user_id": user_id,
        "resource_key": resource_key,
        "content": test_content
    }


@pytest.mark.contract
def test_delete_file_success(test_client, temp_storage_dir, setup_test_file, mock_jwt_token, monkeypatch):
    """
    Test successful file deletion
    """
    # Mock auth verification
    from server.auth import User
    async def mock_verify(*args, **kwargs):
        return User(user_id=setup_test_file["user_id"], username="test_user")
    
    import server.routes.management_routes as mr
    monkeypatch.setattr(mr, "verify_user_and_resource_access", mock_verify)
    
    # Verify file exists before deletion
    storage = get_storage()
    assert storage.check_file_exists(setup_test_file["resource_key"])
    
    # Delete the file
    response = test_client.request(
        "DELETE",
        "/files/delete",
        json={
            "user_id": setup_test_file["user_id"],
            "resource_key": setup_test_file["resource_key"]
        },
        headers={"Authorization": mock_jwt_token}
    )
    
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert "成功" in data["message"]
    
    # Verify file is deleted
    assert not storage.check_file_exists(setup_test_file["resource_key"])


@pytest.mark.contract
def test_delete_file_not_found(test_client, temp_storage_dir, mock_jwt_token, monkeypatch):
    """
    Test deleting non-existent file returns 404
    """
    # Mock auth verification
    from server.auth import User
    async def mock_verify(*args, **kwargs):
        return User(user_id="test_user", username="test_user")
    
    import server.routes.management_routes as mr
    monkeypatch.setattr(mr, "verify_user_and_resource_access", mock_verify)
    
    # Try to delete non-existent file
    response = test_client.request(
        "DELETE",
        "/files/delete",
        json={
            "user_id": "test_user",
            "resource_key": "test_user/nonexistent/v1/file.txt"
        },
        headers={"Authorization": mock_jwt_token}
    )
    
    assert response.status_code == 404
    assert "not found" in response.json()["detail"].lower()


@pytest.mark.contract
def test_delete_file_unauthorized(test_client, temp_storage_dir, setup_test_file, monkeypatch):
    """
    Test deleting file without authorization returns 401
    """
    # Mock auth verification to raise HTTPException
    from fastapi import HTTPException
    async def mock_verify_fail(*args, **kwargs):
        raise HTTPException(status_code=401, detail="Unauthorized")
    
    import server.routes.management_routes as mr
    monkeypatch.setattr(mr, "verify_user_and_resource_access", mock_verify_fail)
    
    # Try to delete without proper auth
    response = test_client.request(
        "DELETE",
        "/files/delete",
        json={
            "user_id": setup_test_file["user_id"],
            "resource_key": setup_test_file["resource_key"]
        },
        headers={"Authorization": "Bearer invalid_token"}
    )
    
    assert response.status_code == 401


@pytest.mark.contract
def test_delete_file_missing_fields(test_client, mock_jwt_token):
    """
    Test request with missing required fields returns validation error
    """
    # Missing resource_key
    response = test_client.request(
        "DELETE",
        "/files/delete",
        json={
            "user_id": "test_user"
            # missing resource_key
        },
        headers={"Authorization": mock_jwt_token}
    )
    
    assert response.status_code == 422  # Validation error

