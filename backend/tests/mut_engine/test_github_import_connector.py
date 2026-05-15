import io
from types import SimpleNamespace
import zipfile

import pytest

from src.connectors.datasource._base import (
    BaseConnector,
    Capability,
    ConnectorSpec,
    Credentials,
    FetchResult,
)
from src.connectors.datasource.engine import SyncEngine
from src.connectors.datasource.github.connector import (
    _extract_zip_files,
    _parse_github_repo_url,
)
from src.connectors.datasource.registry import ConnectorRegistry
from src.connectors.datasource.schemas import Sync


def _zip_bytes(files: dict[str, bytes]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for path, content in files.items():
            archive.writestr(path, content)
    return buffer.getvalue()


def test_github_url_parser_extracts_repo_ref_and_subdir():
    parsed = _parse_github_repo_url("https://github.com/acme/context-kit.git/tree/main/docs/specs")

    assert parsed.owner == "acme"
    assert parsed.repo == "context-kit"
    assert parsed.ref == "main"
    assert parsed.subdir == "docs/specs"


def test_github_zip_extraction_preserves_files_and_skips_generated_or_sensitive_paths():
    archive = _zip_bytes({
        "acme-repo-sha/README.md": b"# Repo",
        "acme-repo-sha/src/app.py": b"print('hello')\n",
        "acme-repo-sha/node_modules/pkg/index.js": b"generated",
        "acme-repo-sha/.env": b"SECRET=1",
        "acme-repo-sha/assets/logo.png": b"\x89PNG\r\n\x00",
        "acme-repo-sha/huge.txt": b"x" * 20,
    })

    extracted = _extract_zip_files(
        archive,
        max_files=10,
        max_total_bytes=1024,
        max_file_bytes=16,
        include_binary=True,
    )

    assert extracted.files["README.md"] == b"# Repo"
    assert extracted.files["src/app.py"] == b"print('hello')\n"
    assert extracted.files["assets/logo.png"].startswith(b"\x89PNG")
    assert "node_modules/pkg/index.js" not in extracted.files
    assert ".env" not in extracted.files
    assert "huge.txt" not in extracted.files
    assert {item["reason"] for item in extracted.skipped} >= {
        "excluded_dir",
        "sensitive_file",
        "file_too_large",
    }


class MultiFileConnector(BaseConnector):
    def spec(self) -> ConnectorSpec:
        return ConnectorSpec(
            provider="github",
            display_name="GitHub",
            capabilities=Capability.PULL,
            supported_directions=["inbound"],
        )

    async def fetch(self, config, credentials):
        return FetchResult(
            content={"manifest": True},
            content_hash="hash-1",
            node_type="folder",
            files={
                "README.md": b"# Repo",
                ".puppyone/import.json": '{"source":"github"}',
            },
            summary="Import from GitHub acme/repo",
        )


class FakeRegistry:
    connector = MultiFileConnector()

    def get(self, provider):
        return self.connector if provider == "github" else None

    async def resolve_credentials(self, oauth_type, user_id, *, required=True):
        return Credentials()


class FakeSyncRepo:
    def __init__(self):
        self.sync = Sync(
            id="sync-1",
            project_id="project-1",
            path="repo",
            provider="github",
            config={
                "data_file": "data.json",
                "external_resource_id": "direct:github:repo",
            },
            status="active",
            created_by="user-1",
        )
        self.sync_point = None

    def get_by_id(self, sync_id):
        assert sync_id == "sync-1"
        return self.sync

    def update_status(self, sync_id, status):
        self.sync.status = status

    def update_sync_point(self, **kwargs):
        self.sync_point = kwargs

    def update_error(self, sync_id, error):
        self.sync.error_message = error


class FakeOps:
    def __init__(self):
        self.bulk_write_call = None

    async def bulk_write(self, project_id, files, who, scope="", deleted=None, message="", defer_projection=False):
        self.bulk_write_call = {
            "project_id": project_id,
            "files": files,
            "who": who,
            "deleted": deleted,
            "message": message,
        }
        return SimpleNamespace(commit_id="commit-1")

    async def write_file(self, *args, **kwargs):
        raise AssertionError("multi-file imports must use bulk_write")


@pytest.mark.asyncio
async def test_sync_engine_commits_github_import_as_bulk_write(monkeypatch):
    fake_ops = FakeOps()

    import src.mut_engine.dependencies as mut_deps

    monkeypatch.setattr(mut_deps, "create_mut_ops", lambda: fake_ops)

    sync_repo = FakeSyncRepo()
    engine = SyncEngine(registry=FakeRegistry(), sync_repo=sync_repo)

    result = await engine.execute("sync-1")

    assert result["path"] == "repo"
    assert result["commit_id"] == "commit-1"
    assert fake_ops.bulk_write_call["files"] == {
        "repo/README.md": b"# Repo",
        "repo/.puppyone/import.json": b'{"source":"github"}',
    }
    assert fake_ops.bulk_write_call["deleted"] == ["repo/data.json"]
    assert sync_repo.sync_point["remote_hash"] == "hash-1"


class MissingOAuthService:
    async def refresh_token_if_needed(self, user_id):
        return None


@pytest.mark.asyncio
async def test_registry_optional_oauth_allows_public_import_without_connection():
    registry = ConnectorRegistry()
    registry.register_oauth("github", MissingOAuthService())

    credentials = await registry.resolve_credentials(
        oauth_type="github",
        user_id="user-1",
        required=False,
    )

    assert credentials.access_token == ""
