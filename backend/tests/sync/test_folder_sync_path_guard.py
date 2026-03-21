import asyncio
from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

from src.connectors.filesystem.service import FolderSyncService, _validate_filename
from src.connectors.filesystem.router import router as folder_sync_router
import src.connectors.filesystem.router as folder_router_module


def _build_folder_sync_service() -> FolderSyncService:
    svc = object.__new__(FolderSyncService)
    svc._supabase = None
    return svc


@pytest.mark.parametrize(
    "filename",
    ["../x.md", "a/../b.md", "./x.md", "a//b.md", "a/\x00b.md"],
)
@pytest.mark.asyncio
async def test_folder_sync_rejects_invalid_path_segments(filename: str):
    svc = _build_folder_sync_service()

    result = await svc.push(
        project_id="project-1",
        folder_path="folder-1",
        filename=filename,
        content={},
        base_version=0,
        node_type="json",
        operator_id="sync:1",
        operator_name="OpenClaw CLI",
        source_id="1",
    )

    assert result["ok"] is False
    assert result["error"] == "invalid_path"


def test_folder_sync_accepts_normal_nested_path():
    assert _validate_filename("a/b/c.md") is None


def test_folder_sync_accepts_nested_dotfiles():
    assert _validate_filename("a/.gitkeep") is None
    assert _validate_filename(".well-known/openid-configuration") is None


@pytest.mark.asyncio
async def test_folder_sync_delete_rejects_invalid_path():
    svc = _build_folder_sync_service()
    result = await svc.delete_file(
        project_id="project-1",
        folder_path="folder-1",
        filename="../x.md",
        source_id="1",
    )
    assert result["ok"] is False
    assert result["error"] == "invalid_path"


@pytest.mark.asyncio
async def test_folder_sync_upload_url_rejects_invalid_path():
    svc = _build_folder_sync_service()
    result = await svc.request_upload_url(
        project_id="project-1",
        folder_path="folder-1",
        filename="../x.bin",
        content_type="application/octet-stream",
        size_bytes=123,
        operator_id="sync:1",
        source_id="1",
    )
    assert result["ok"] is False
    assert result["error"] == "invalid_path"


@pytest.mark.asyncio
async def test_folder_sync_confirm_upload_rejects_invalid_path():
    svc = _build_folder_sync_service()
    result = await svc.confirm_upload(
        project_id="project-1",
        folder_path="folder-1",
        filename="../x.bin",
        s3_key="projects/p/filesystem/f/abc.bin",
        operator_id="sync:1",
        source_id="1",
    )
    assert result["ok"] is False
    assert result["error"] == "invalid_path"


@pytest.fixture
def folder_router_client(monkeypatch):
    fake_sync = SimpleNamespace(id="1", project_id="project-1")

    async def _push(**kwargs):
        return {"ok": False, "error": "invalid_path", "message": "bad"}

    async def _delete_file(**kwargs):
        return {"ok": False, "error": "invalid_path", "message": "bad"}

    async def _request_upload_url(**kwargs):
        return {"ok": False, "error": "invalid_path", "message": "bad"}

    async def _confirm_upload(**kwargs):
        return {"ok": False, "error": "invalid_path", "message": "bad"}

    fake_service = SimpleNamespace(
        push=_push,
        delete_file=_delete_file,
        request_upload_url=_request_upload_url,
        confirm_upload=_confirm_upload,
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
