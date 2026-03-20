"""Tests for filesystem binary file handling via MutOps."""

from types import SimpleNamespace

import pytest

import src.connectors.filesystem.service as fs_service_module
from src.connectors.filesystem.service import FolderSyncService, _validate_filename


def _build_service() -> FolderSyncService:
    svc = object.__new__(FolderSyncService)
    svc._supabase = None
    return svc


class _FakeOps:
    def list_tree(self, project_id: str, path: str):
        return [
            SimpleNamespace(
                name="report.pdf",
                path="folder-1/report.pdf",
                type="file",
                size_bytes=12,
            )
        ]

    def read_file(self, project_id: str, path: str) -> bytes:
        return (
            b'{\n'
            b'  "_type": "file_ref",\n'
            b'  "_s3_key": "projects/project-1/filesystem/folder-1/report.pdf",\n'
            b'  "filename": "report.pdf"\n'
            b'}'
        )

    def get_version(self, project_id: str) -> int:
        return 9


class _FakeS3Client:
    def generate_presigned_url(self, ClientMethod, Params, ExpiresIn):  # noqa: N803
        return f"https://example.test/{Params['Key']}"


class _FakeS3Service:
    bucket_name = "bucket"
    client = _FakeS3Client()


@pytest.mark.asyncio
async def test_request_upload_url_rejects_traversal():
    svc = _build_service()
    result = await svc.request_upload_url(
        project_id="project-1",
        folder_id="folder-1",
        filename="../report.pdf",
        content_type="application/pdf",
        size_bytes=12,
        operator_id="sync:1",
    )
    assert result["ok"] is False
    assert result["error"] == "invalid_path"


def test_validate_filename_accepts_binary_extension():
    assert _validate_filename("report.pdf") is None
    assert _validate_filename("data.xlsx") is None
    assert _validate_filename("sub/folder/report.pdf") is None
    assert _validate_filename("sub/.gitkeep") is None


def test_validate_filename_rejects_traversal():
    assert _validate_filename("../report.pdf") is not None
    assert _validate_filename("a/../b.pdf") is not None


def test_pull_binary_file_preserves_file_type_and_download_url(monkeypatch):
    svc = _build_service()
    svc._get_ops = lambda: _FakeOps()
    monkeypatch.setattr(
        fs_service_module,
        "get_s3_service_instance",
        lambda: _FakeS3Service(),
    )

    result = svc.pull(project_id="project-1", folder_id="folder-1")

    assert result["version"] == 9
    assert len(result["files"]) == 1
    file_info = result["files"][0]
    assert file_info["type"] == "file"
    assert file_info["version"] == 9
    assert file_info["s3_key"] == "projects/project-1/filesystem/folder-1/report.pdf"
    assert file_info["download_url"] == "https://example.test/projects/project-1/filesystem/folder-1/report.pdf"


@pytest.mark.asyncio
async def test_confirm_upload_rejects_traversal():
    svc = _build_service()
    result = await svc.confirm_upload(
        project_id="project-1",
        folder_id="folder-1",
        filename="../evil.bin",
        s3_key="projects/p/filesystem/f/abc.bin",
        operator_id="sync:1",
    )
    assert result["ok"] is False
    assert result["error"] == "invalid_path"
