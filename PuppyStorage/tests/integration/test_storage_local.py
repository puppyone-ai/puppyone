import os
import uuid
import pytest


@pytest.mark.integration
@pytest.mark.local
def test_local_storage_crud(tmp_storage_dir):
    # Prefer test-specific storage root to avoid polluting repo dir
    os.environ["DEPLOYMENT_TYPE"] = "local"

    # Point LOCAL_STORAGE_PATH to tmp dir and align config.paths if available
    os.environ["LOCAL_STORAGE_PATH"] = str(tmp_storage_dir)
    try:
        from utils.config import paths
        paths.STORAGE_ROOT = str(tmp_storage_dir)
    except Exception:
        pass

    from storage import reset_storage_manager, get_storage
    from storage.local import LocalStorageAdapter

    reset_storage_manager()
    adapter = get_storage()
    assert isinstance(adapter, LocalStorageAdapter)

    # CRUD
    prefix = f"test/{uuid.uuid4().hex}"
    key = f"{prefix}/demo.txt"
    data = b"hello"
    content_type = "text/plain"

    # Create
    ok = adapter.save_file(key, data, content_type)
    assert ok
    assert adapter.check_file_exists(key)

    # Read
    got, got_type = adapter.get_file(key)
    assert got == data
    assert got_type == content_type

    # List
    listed = adapter.list_objects(prefix=prefix)
    assert any(obj.get("key", "").endswith("demo.txt") for obj in listed)

    # Delete
    assert adapter.delete_file(key)
    assert not adapter.check_file_exists(key)


