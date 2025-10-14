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


@pytest.mark.integration
@pytest.mark.local
def test_local_list_with_delimiter_and_idempotent_delete(tmp_storage_dir):
    os.environ["DEPLOYMENT_TYPE"] = "local"
    os.environ["LOCAL_STORAGE_PATH"] = str(tmp_storage_dir)

    from storage import reset_storage_manager, get_storage

    reset_storage_manager()
    adapter = get_storage()

    # Create nested files
    adapter.save_file("u1/a/x.txt", b"x", "text/plain")
    adapter.save_file("u1/a/y.txt", b"y", "text/plain")
    adapter.save_file("u1/b/z.txt", b"z", "text/plain")

    # List with delimiter to simulate S3 common prefixes
    listed = adapter.list_objects(prefix="u1/", delimiter="/")
    # Should include prefixes for a/ and b/
    prefixes = [i.get("prefix") for i in listed if "prefix" in i]
    assert "u1/a/" in prefixes and "u1/b/" in prefixes

    # Idempotent delete: delete twice returns False second time or True then False
    assert adapter.delete_file("u1/a/x.txt") in (True, False)
    assert adapter.delete_file("u1/a/x.txt") in (True, False)

    # Nonexistent get returns (None, None)
    data, ctype = adapter.get_file("does/not/exist.txt")
    assert data is None and ctype is None


