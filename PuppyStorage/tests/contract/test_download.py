"""
Contract tests for download operations
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
    """Setup a test file for download"""
    storage = get_storage()
    
    # Create a test file
    user_id = "test_user"
    resource_key = f"{user_id}/test_block/v1/test_download.txt"
    test_content = b"Test file content for download"
    
    # Save the file (correct method name)
    storage.save_file(resource_key, test_content, content_type="text/plain")
    
    return {
        "user_id": user_id,
        "resource_key": resource_key,
        "content": test_content
    }


# === Test GET /download/url ===

@pytest.mark.contract
def test_get_download_url_success(test_client, temp_storage_dir, setup_test_file, mock_jwt_token, monkeypatch):
    """
    Test successfully getting download URL for local storage
    """
    # Mock auth verification
    from server.auth import User
    async def mock_verify(*args, **kwargs):
        return User(user_id=setup_test_file["user_id"], username="test_user")
    
    import server.routes.download_routes as dr
    monkeypatch.setattr(dr, "verify_download_auth", mock_verify)
    
    # Get download URL
    response = test_client.get(
        f"/download/url?key={setup_test_file['resource_key']}",
        headers={"Authorization": mock_jwt_token}
    )
    
    assert response.status_code == 200
    data = response.json()
    assert "download_url" in data
    assert data["key"] == setup_test_file["resource_key"]
    assert "expires_at" in data
    assert data["expires_at"] > 0


@pytest.mark.contract
def test_get_download_url_invalid_key_format(test_client, temp_storage_dir, mock_jwt_token, monkeypatch):
    """
    Test getting download URL with invalid key format returns 400
    """
    # Mock auth verification
    from server.auth import User
    async def mock_verify(*args, **kwargs):
        return User(user_id="test_user", username="test_user")
    
    import server.routes.download_routes as dr
    monkeypatch.setattr(dr, "verify_download_auth", mock_verify)
    
    # Try with invalid key (only 2 parts)
    response = test_client.get(
        "/download/url?key=invalid/key",
        headers={"Authorization": mock_jwt_token}
    )
    
    assert response.status_code == 400
    assert "Invalid key format" in response.json()["detail"]


@pytest.mark.contract
def test_get_download_url_file_not_found(test_client, temp_storage_dir, mock_jwt_token, monkeypatch):
    """
    Test getting download URL for non-existent file returns 404
    """
    # Mock auth verification
    from server.auth import User
    async def mock_verify(*args, **kwargs):
        return User(user_id="test_user", username="test_user")
    
    import server.routes.download_routes as dr
    monkeypatch.setattr(dr, "verify_download_auth", mock_verify)
    
    # Try to get URL for non-existent file
    response = test_client.get(
        "/download/url?key=test_user/nonexistent/v1/file.txt",
        headers={"Authorization": mock_jwt_token}
    )
    
    assert response.status_code == 404
    assert "not found" in response.json()["detail"].lower()


@pytest.mark.contract
def test_get_download_url_unauthorized(test_client, temp_storage_dir, setup_test_file, monkeypatch):
    """
    Test getting download URL without authorization returns 401
    """
    # Mock auth verification to raise HTTPException
    from fastapi import HTTPException
    async def mock_verify_fail(*args, **kwargs):
        raise HTTPException(status_code=401, detail="Unauthorized")
    
    import server.routes.download_routes as dr
    monkeypatch.setattr(dr, "verify_download_auth", mock_verify_fail)
    
    # Try without proper auth
    response = test_client.get(
        f"/download/url?key={setup_test_file['resource_key']}",
        headers={"Authorization": "Bearer invalid_token"}
    )
    
    assert response.status_code == 401


@pytest.mark.contract
def test_get_download_url_with_custom_expires(test_client, temp_storage_dir, setup_test_file, mock_jwt_token, monkeypatch):
    """
    Test getting download URL with custom expiration time
    """
    # Mock auth verification
    from server.auth import User
    async def mock_verify(*args, **kwargs):
        return User(user_id=setup_test_file["user_id"], username="test_user")
    
    import server.routes.download_routes as dr
    monkeypatch.setattr(dr, "verify_download_auth", mock_verify)
    
    # Get download URL with 1 hour expiration
    response = test_client.get(
        f"/download/url?key={setup_test_file['resource_key']}&expires_in=3600",
        headers={"Authorization": mock_jwt_token}
    )
    
    assert response.status_code == 200
    data = response.json()
    assert "expires_at" in data


# === Test GET /download/stream/{key} ===

@pytest.mark.contract
def test_stream_local_file_success(test_client, temp_storage_dir, setup_test_file):
    """
    Test successfully streaming a local file
    """
    # Stream the file
    response = test_client.get(f"/download/stream/{setup_test_file['resource_key']}")
    
    assert response.status_code == 200
    assert response.content == setup_test_file["content"]
    assert "Accept-Ranges" in response.headers
    assert response.headers["Accept-Ranges"] == "bytes"


@pytest.mark.contract
def test_stream_local_file_with_range(test_client, temp_storage_dir, setup_test_file):
    """
    Test streaming a local file with Range request (partial content)
    """
    # Request first 10 bytes
    response = test_client.get(
        f"/download/stream/{setup_test_file['resource_key']}",
        headers={"Range": "bytes=0-9"}
    )
    
    assert response.status_code == 206  # Partial Content
    assert len(response.content) == 10
    assert response.content == setup_test_file["content"][:10]
    assert "Content-Range" in response.headers


@pytest.mark.contract
def test_stream_local_file_invalid_key_format(test_client, temp_storage_dir):
    """
    Test streaming with invalid key format returns 400
    """
    # Try with invalid key format
    response = test_client.get("/download/stream/invalid/key")
    
    assert response.status_code == 400
    assert "Invalid key format" in response.json()["detail"]


@pytest.mark.contract
def test_stream_local_file_not_found(test_client, temp_storage_dir):
    """
    Test streaming non-existent file returns 404
    """
    # Try to stream non-existent file
    response = test_client.get("/download/stream/test_user/nonexistent/v1/file.txt")
    
    assert response.status_code == 404
    assert "not found" in response.json()["detail"].lower()


@pytest.mark.contract
def test_stream_local_file_content_type(test_client, temp_storage_dir):
    """
    Test that streaming sets correct Content-Type based on file extension
    """
    storage = get_storage()
    
    # Create a JSON file
    json_key = "test_user/test_block/v1/test.json"
    storage.save_file(json_key, b'{"test": "data"}', content_type="application/json")
    
    response = test_client.get(f"/download/stream/{json_key}")
    
    assert response.status_code == 200
    # Should detect JSON mime type
    assert "json" in response.headers.get("Content-Type", "").lower()


@pytest.mark.contract  
def test_stream_local_file_content_disposition(test_client, temp_storage_dir, setup_test_file):
    """
    Test that streaming sets Content-Disposition header for download
    """
    response = test_client.get(f"/download/stream/{setup_test_file['resource_key']}")
    
    assert response.status_code == 200
    assert "Content-Disposition" in response.headers
    assert "attachment" in response.headers["Content-Disposition"]
    assert "test_download.txt" in response.headers["Content-Disposition"]

