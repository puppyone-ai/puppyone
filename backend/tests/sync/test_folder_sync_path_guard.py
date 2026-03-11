from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

from src.connectors.filesystem.service import FolderSyncService
from src.connectors.filesystem.router import router as folder_sync_router
import src.connectors.filesystem.router as folder_router_module


def _build_folder_sync_service() -> FolderSyncService:
    svc = object.__new__(FolderSyncService)
    svc._node_repo = SimpleNamespace()
    svc._s3 = SimpleNamespace(
        bucket_name="bucket",
        client=SimpleNamespace(
            generate_presigned_url=lambda **kwargs: "https://example.test/upload"
        ),
    )
    svc._get_project_owner = lambda project_id: "owner-1"
    return svc


@pytest.mark.parametrize(
    "filename",
    ["../x.md", "a/../b.md", "./x.md", "a//b.md", "a/\x00b.md"],
)
def test_folder_sync_rejects_invalid_path_segments(filename: str):
    svc = _build_folder_sync_service()

    result = svc.push(
        project_id="project-1",
        folder_id="folder-1",
        filename=filename,
        content={},
        base_version=0,
        node_type="json",
        operator_id="sync:1",
        operator_name="OpenClaw CLI",
        source_id=1,
    )

    assert result["ok"] is False
    assert result["error"] == "invalid_path"


def test_folder_sync_accepts_normal_nested_path():
    svc = _build_folder_sync_service()
    assert svc._validate_filename_or_error("a/b/c.md", operation="push") is None


def test_folder_sync_delete_rejects_invalid_path():
    svc = _build_folder_sync_service()
    result = svc.delete_file(
        project_id="project-1",
        folder_id="folder-1",
        filename="../x.md",
        source_id=1,
    )
    assert result["ok"] is False
    assert result["error"] == "invalid_path"


def test_folder_sync_upload_url_rejects_invalid_path():
    svc = _build_folder_sync_service()
    result = svc.request_upload_url(
        project_id="project-1",
        folder_id="folder-1",
        filename="../x.bin",
        content_type="application/octet-stream",
        size_bytes=123,
        operator_id="sync:1",
        source_id=1,
    )
    assert result["ok"] is False
    assert result["error"] == "invalid_path"


def test_folder_sync_confirm_upload_rejects_invalid_path():
    svc = _build_folder_sync_service()
    result = svc.confirm_upload(
        project_id="project-1",
        folder_id="folder-1",
        filename="../x.bin",
        size_bytes=123,
        operator_id="sync:1",
        operator_name="OpenClaw CLI",
        source_id=1,
    )
    assert result["ok"] is False
    assert result["error"] == "invalid_path"


@pytest.fixture
def folder_router_client(monkeypatch):
    fake_sync = SimpleNamespace(id=1, project_id="project-1")
    fake_service = SimpleNamespace(
        push=lambda **kwargs: {"ok": False, "error": "invalid_path", "message": "bad"},
        delete_file=lambda **kwargs: {"ok": False, "error": "invalid_path", "message": "bad"},
        request_upload_url=lambda **kwargs: {"ok": False, "error": "invalid_path", "message": "bad"},
        confirm_upload=lambda **kwargs: {"ok": False, "error": "invalid_path", "message": "bad"},
    )

    monkeypatch.setattr(
        folder_router_module,
        "_auth_folder",
        lambda access_key, folder_id: (fake_sync, fake_service),
    )

    app = FastAPI()
    app.include_router(folder_sync_router)
    with TestClient(app) as client:
        yield client


def test_folder_router_push_invalid_path_returns_400(folder_router_client: TestClient):
    response = folder_router_client.post(
        "/api/v1/filesystem/folder-1/push",
        headers={"X-Access-Key": "k"},
        json={"filename": "../x.md", "content": {}, "base_version": 0, "node_type": "json"},
    )
    assert response.status_code == 400


def test_folder_router_delete_invalid_path_returns_400(folder_router_client: TestClient):
    response = folder_router_client.delete(
        "/api/v1/filesystem/folder-1/file/x.md",
        headers={"X-Access-Key": "k"},
    )
    assert response.status_code == 400


def test_folder_router_upload_url_invalid_path_returns_400(folder_router_client: TestClient):
    response = folder_router_client.post(
        "/api/v1/filesystem/folder-1/upload-url",
        headers={"X-Access-Key": "k"},
        json={
            "filename": "../x.bin",
            "content_type": "application/octet-stream",
            "size_bytes": 12,
        },
    )
    assert response.status_code == 400
