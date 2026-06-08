from src.connectors.datasource._base import FetchResult
from src.connectors.datasource.schemas import Sync
from src.platform.integrations.paths import (
    canonical_provider,
    plan_fetch_result,
)


def _sync(path: str, config: dict | None = None) -> Sync:
    return Sync(
        id="conn-1",
        project_id="project-1",
        path=path,
        provider="google_calendar",
        config=config or {"target_path": path},
    )


def test_direct_existing_file_target_writes_exact_path():
    result = FetchResult(
        content={"events": []},
        content_hash="abc",
        node_type="json",
        node_name="Google Calendar",
    )

    plan = plan_fetch_result(
        sync=_sync("Calendar Events"),
        result=result,
        target_exists_as_file=True,
    )

    assert list(plan.files) == ["Calendar Events"]
    assert plan.deleted == []
    assert plan.result_path == "Calendar Events"


def test_folder_target_uses_connector_filename():
    result = FetchResult(
        content="# hello",
        content_hash="abc",
        node_type="markdown",
        node_name="Meeting Notes",
    )

    plan = plan_fetch_result(
        sync=_sync("External"),
        result=result,
        target_exists_as_file=False,
    )

    assert list(plan.files) == ["External/Meeting Notes.md"]
    assert plan.result_path == "External/Meeting Notes.md"


def test_legacy_data_file_still_maps_under_target_path():
    result = FetchResult(
        content={"rows": []},
        content_hash="abc",
        node_type="json",
        node_name="Sheet",
    )

    plan = plan_fetch_result(
        sync=_sync("Sheets", {"target_path": "Sheets", "data_file": "data.json"}),
        result=result,
        target_exists_as_file=False,
    )

    assert list(plan.files) == ["Sheets/data.json"]


def test_provider_aliases_are_canonicalized_at_boundary():
    assert canonical_provider("docs") == "google_docs"
    assert canonical_provider("calendar") == "google_calendar"
    assert canonical_provider("google_search_console") == "google_search_console"
