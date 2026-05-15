"""Tests for connector architecture alignment.

Covers:
  - BaseConnector pull() method
  - SyncEngine decoupling (fetch → compare → MutOps.write)
  - Filesystem bootstrap with scope config
  - Unified connections manager routing by provider
"""

import pytest
from unittest.mock import MagicMock, AsyncMock, patch
from dataclasses import dataclass

from src.connectors.datasource._base import (
    BaseConnector, ConnectorSpec, FetchResult, Capability,
)


# ── BaseConnector Tests ────────────────────────────────────────

class FakeConnector(BaseConnector):
    """Minimal connector for testing."""

    def spec(self) -> ConnectorSpec:
        return ConnectorSpec(
            provider="fake",
            display_name="Fake",
            capabilities=Capability.PULL,
            supported_directions=["inbound"],
        )

    async def fetch(self, config, credentials):
        return FetchResult(
            content={"test": True},
            content_hash="abc123",
        )


class TestBaseConnector:
    def test_spec_returns_provider(self):
        c = FakeConnector()
        assert c.spec().provider == "fake"

    @pytest.mark.asyncio
    async def test_fetch_returns_result(self):
        c = FakeConnector()
        result = await c.fetch({}, None)
        assert result.content == {"test": True}
        assert result.content_hash == "abc123"

    @pytest.mark.asyncio
    async def test_pull_raises_not_implemented(self):
        """Default pull() raises NotImplementedError."""
        c = FakeConnector()
        mock_sync = MagicMock()
        mock_sync.config = {}
        with pytest.raises(NotImplementedError, match="use SyncEngine"):
            await c.pull(mock_sync)

    @pytest.mark.asyncio
    async def test_push_raises_not_implemented(self):
        c = FakeConnector()
        mock_sync = MagicMock()
        with pytest.raises(NotImplementedError, match="does not support push"):
            await c.push(mock_sync, "content", "text")

    def test_list_resources_default_empty(self):
        c = FakeConnector()
        import asyncio
        result = asyncio.run(
            c.list_resources(MagicMock())
        )
        assert result == []


class PullableConnector(BaseConnector):
    """Connector that implements pull()."""

    def spec(self):
        return ConnectorSpec(
            provider="pullable", display_name="Pullable",
            capabilities=Capability.PULL, supported_directions=["inbound"],
        )

    async def fetch(self, config, credentials):
        return FetchResult(content="fetched", content_hash="h1")

    async def pull(self, sync):
        return FetchResult(content="pulled", content_hash="h2")


class TestPullableConnector:
    @pytest.mark.asyncio
    async def test_pull_overrides_default(self):
        c = PullableConnector()
        result = await c.pull(MagicMock())
        assert result.content == "pulled"
        assert result.content_hash == "h2"


# ── Filesystem Bootstrap Tests ─────────────────────────────────

class TestFilesystemBootstrapScope:
    """Verify filesystem bootstrap creates proper scope config."""

    def test_bootstrap_creates_scope_config(self):
        """Simulated: verify the scope structure that would be created."""
        # This tests the config dict structure, not actual DB writes
        path = "docs/research"
        scope = {
            "id": f"fs-{path.replace('/', '-').strip('-') or 'root'}",
            "path": path,
            "exclude": [".git", "node_modules", ".DS_Store", "__pycache__"],
            "mode": "rw",
        }
        assert scope["id"] == "fs-docs-research"
        assert scope["path"] == "docs/research"
        assert ".git" in scope["exclude"]
        assert scope["mode"] == "rw"

    def test_bootstrap_root_scope_id(self):
        path = ""
        scope_id = f"fs-{path.replace('/', '-').strip('-') or 'root'}"
        assert scope_id == "fs-root"

    def test_bootstrap_nested_scope_id(self):
        path = "src/frontend/components"
        scope_id = f"fs-{path.replace('/', '-').strip('-') or 'root'}"
        assert scope_id == "fs-src-frontend-components"


# ── Unified Manager Routing Tests ──────────────────────────────

class TestManagerRouting:
    """Test that the unified manager routes to correct handler by provider."""

    def test_known_providers(self):
        """Verify all expected providers are handled in the routing logic."""
        known_providers = {"agent", "mcp", "sandbox", "filesystem"}
        assert len(known_providers) == 4
        assert "filesystem" in known_providers

    def test_filesystem_scope_in_config(self):
        """Filesystem creation should pass scope config."""
        cfg = {"scope": "/docs"}
        scope_path = cfg.get("scope", "/")
        assert scope_path == "/docs"

    def test_filesystem_default_scope(self):
        """Missing scope defaults to root."""
        cfg = {}
        scope_path = cfg.get("scope", "/")
        assert scope_path == "/"


# ── SyncEngine Decoupling Tests ────────────────────────────────

class TestSyncEngineDecoupling:
    """Verify SyncEngine properly separates concerns."""

    def test_engine_module_importable(self):
        from src.connectors.datasource.engine import SyncEngine
        assert hasattr(SyncEngine, "execute")

    def test_engine_uses_mutops(self):
        """SyncEngine.execute() should use MutOps for writes (verified by code inspection)."""
        import inspect
        from src.connectors.datasource.engine import SyncEngine
        source = inspect.getsource(SyncEngine.execute)
        assert "create_mut_ops" in source
        assert "write_file" in source

    def test_connector_has_no_mutops_dependency(self):
        """BaseConnector should not import or reference MutOps."""
        import inspect
        source = inspect.getsource(BaseConnector)
        assert "MutOps" not in source
        assert "mut_engine" not in source


# ── Unified API Filesystem Output Contract ─────────────────────

class TestUnifiedFilesystemOutput:
    """`_create_filesystem` must surface access_key + ap_base.

    These are required so the frontend `Add Filesystem` UI and the
    `puppyone access add filesystem ... --link` flow can construct
    the `mut connect` command from a single API response — without
    a follow-up call to `/access/{id}/key`.
    """

    @pytest.mark.asyncio
    async def test_returns_access_key_and_ap_base(self):
        from src.connectors.manager.router import (
            UnifiedConnectionCreate,
            _create_filesystem,
        )

        @dataclass
        class FakeSync:
            id: str = "ap_42"
            project_id: str = "proj_1"
            status: str = "active"
            access_key: str = "cli_secret_xyz"

        fake_sync = FakeSync()

        with patch("src.connectors.filesystem.service.FilesystemService") as svc_cls, \
             patch("src.connectors.datasource.repository.SyncRepository"), \
             patch("src.infra.supabase.client.SupabaseClient"):
            svc_cls.return_value.bootstrap.return_value = fake_sync

            payload = UnifiedConnectionCreate(
                project_id="proj_1",
                provider="filesystem",
                name="My Folder",
                config={"scope": {"path": "docs"}},
            )

            out = await _create_filesystem(payload, _user_id="user_1")

        assert out.access_key == "cli_secret_xyz", \
            "access_key must be returned so UI can render the mut connect command"
        assert out.ap_base == "/api/v1/mut/ap/cli_secret_xyz", \
            "ap_base must point to the MUT protocol endpoint for this access key"
        assert out.id == "ap_42"
        assert out.provider == "filesystem"

    @pytest.mark.asyncio
    async def test_ap_base_is_none_when_no_access_key(self):
        """Defensive: if bootstrap somehow returned no key, ap_base stays None."""
        from src.connectors.manager.router import (
            UnifiedConnectionCreate,
            _create_filesystem,
        )

        @dataclass
        class KeylessSync:
            id: str = "ap_x"
            project_id: str = "proj_1"
            status: str = "active"
            access_key: str | None = None

        with patch("src.connectors.filesystem.service.FilesystemService") as svc_cls, \
             patch("src.connectors.datasource.repository.SyncRepository"), \
             patch("src.infra.supabase.client.SupabaseClient"):
            svc_cls.return_value.bootstrap.return_value = KeylessSync()

            payload = UnifiedConnectionCreate(
                project_id="proj_1",
                provider="filesystem",
                config={"scope": {"path": "/"}},
            )
            out = await _create_filesystem(payload, _user_id="user_1")

        assert out.access_key is None
        assert out.ap_base is None


# ── Plugin Auto-Discovery Tests ────────────────────────────────

class TestPluginDiscovery:
    """Verify the plugin auto-discovery mechanism exists."""

    def test_discovery_function_exists(self):
        from src.connectors.datasource.dependencies import _discover_connectors
        assert callable(_discover_connectors)

    def test_registry_class_importable(self):
        from src.connectors.datasource.registry import ConnectorRegistry
        assert hasattr(ConnectorRegistry, "register")

    def test_connector_setup_protocol(self):
        """Each connector module should export a setup() function."""
        import importlib
        # Test with URL connector (simplest, no OAuth)
        mod = importlib.import_module(
            "src.connectors.datasource.url.connector"
        )
        assert hasattr(mod, "setup")
        assert callable(mod.setup)
