"""Tests for MCP Supabase repository — field mapping and CRUD."""

import pytest
from unittest.mock import Mock
from datetime import datetime

from src.infra.mcp_server.repository import McpInstanceRepositorySupabase
from src.infra.mcp_server.supabase_schemas import McpResponse


@pytest.fixture
def mock_supabase_repo():
    return Mock()


@pytest.fixture
def mcp_supabase_repo(mock_supabase_repo):
    repo = McpInstanceRepositorySupabase.__new__(McpInstanceRepositorySupabase)
    repo._repo = mock_supabase_repo
    return repo


@pytest.fixture
def sample_mcp_response():
    return McpResponse(
        id=1,
        created_at=datetime.now(),
        api_key="test-api-key",
        created_by="user-100",
        project_id="proj-200",
        table_id="tbl-300",
        json_path="/data/users",
        status=True,
        port=8080,
        docker_info={"container_id": "abc123"},
        tools_definition={
            "query_data": {
                "name": "query_tool",
                "description": "query table rows",
            }
        },
        register_tools=["query_data", "create"],
        preview_keys=["name", "email"],
    )


def test_mcp_response_to_instance_conversion(mcp_supabase_repo, sample_mcp_response):
    instance = mcp_supabase_repo._mcp_response_to_instance(sample_mcp_response)

    assert instance.mcp_instance_id == "1"
    assert instance.api_key == "test-api-key"
    assert instance.created_by == "user-100"
    assert instance.project_id == "proj-200"
    assert instance.table_id == "tbl-300"
    assert instance.json_path == "/data/users"
    assert instance.status == 1  # True → 1
    assert instance.port == 8080
    assert instance.docker_info == {"container_id": "abc123"}


def test_mcp_response_to_instance_with_false_status(mcp_supabase_repo):
    mcp_response = McpResponse(
        id=2,
        created_at=datetime.now(),
        api_key="test-key",
        created_by="user-1",
        project_id="proj-1",
        table_id="tbl-1",
        json_path="",
        status=False,
        port=8080,
        docker_info={},
    )
    instance = mcp_supabase_repo._mcp_response_to_instance(mcp_response)
    assert instance.status == 0


def test_mcp_response_to_instance_with_none_values(mcp_supabase_repo):
    mcp_response = McpResponse(
        id=3,
        created_at=datetime.now(),
    )
    instance = mcp_supabase_repo._mcp_response_to_instance(mcp_response)
    assert instance.mcp_instance_id == "3"
    assert instance.api_key == ""
    assert instance.project_id == ""
    assert instance.table_id == ""
    assert instance.json_path == ""
    assert instance.status == 0


def test_get_by_id_success(mcp_supabase_repo, mock_supabase_repo, sample_mcp_response):
    mock_supabase_repo.get_mcp.return_value = sample_mcp_response
    instance = mcp_supabase_repo.get_by_id("1")
    assert instance is not None
    assert instance.mcp_instance_id == "1"
    mock_supabase_repo.get_mcp.assert_called_once_with(1)


def test_get_by_id_not_found(mcp_supabase_repo, mock_supabase_repo):
    mock_supabase_repo.get_mcp.return_value = None
    instance = mcp_supabase_repo.get_by_id("999")
    assert instance is None


def test_get_by_api_key_success(mcp_supabase_repo, mock_supabase_repo, sample_mcp_response):
    mock_supabase_repo.get_mcp_by_api_key.return_value = sample_mcp_response
    instance = mcp_supabase_repo.get_by_api_key("test-api-key")
    assert instance is not None
    assert instance.api_key == "test-api-key"


def test_get_by_project_id(mcp_supabase_repo, mock_supabase_repo, sample_mcp_response):
    mock_supabase_repo.get_mcps.return_value = [sample_mcp_response]
    instances = mcp_supabase_repo.get_by_project_id("proj-200")
    assert len(instances) == 1
    assert instances[0].project_id == "proj-200"


def test_delete_by_id_success(mcp_supabase_repo, mock_supabase_repo):
    mock_supabase_repo.delete_mcp.return_value = True
    result = mcp_supabase_repo.delete_by_id("1")
    assert result is True
    mock_supabase_repo.delete_mcp.assert_called_once_with(1)


def test_delete_by_api_key_success(mcp_supabase_repo, mock_supabase_repo):
    mock_supabase_repo.delete_mcp_by_api_key.return_value = True
    result = mcp_supabase_repo.delete_by_api_key("test-api-key")
    assert result is True
