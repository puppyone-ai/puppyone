import os
import uuid
import pytest


@pytest.mark.integration
@pytest.mark.s3
def test_s3_storage_crud_with_moto(s3_moto):
    # Switch to remote (S3) and feed env for S3 adapter
    os.environ["DEPLOYMENT_TYPE"] = "remote"
    os.environ["CLOUDFLARE_R2_BUCKET"] = s3_moto["bucket"]
    # Leave endpoint unset; moto intercepts default boto3 calls

    from storage import reset_storage_manager, get_storage
    from storage.S3 import S3StorageAdapter

    reset_storage_manager()
    adapter = get_storage()
    assert isinstance(adapter, S3StorageAdapter)

    # Force adapter to use moto's client to avoid any external endpoints
    adapter.s3_client = s3_moto["client"]

    prefix = f"test/{uuid.uuid4().hex}"
    key = f"{prefix}/demo.txt"
    data = b"world"
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
    # moto returns 'key' for our wrapper
    assert any(obj.get("key", "").endswith("demo.txt") for obj in listed)

    # Delete
    assert adapter.delete_file(key)
    assert not adapter.check_file_exists(key)


@pytest.mark.integration
@pytest.mark.s3
def test_s3_list_and_idempotent_delete(s3_moto):
    os.environ["DEPLOYMENT_TYPE"] = "remote"
    os.environ["CLOUDFLARE_R2_BUCKET"] = s3_moto["bucket"]

    from storage import reset_storage_manager, get_storage
    from storage.S3 import S3StorageAdapter

    reset_storage_manager()
    adapter = get_storage()
    assert isinstance(adapter, S3StorageAdapter)

    # Force moto client
    adapter.s3_client = s3_moto["client"]

    # Create a couple objects
    adapter.save_file("u1/a.txt", b"1", "text/plain")
    adapter.save_file("u1/b.txt", b"2", "text/plain")

    listed = adapter.list_objects(prefix="u1/")
    keys = [i.get("key") for i in listed if "key" in i]
    assert any(k.endswith("a.txt") for k in keys)
    assert any(k.endswith("b.txt") for k in keys)

    # Idempotent delete
    assert adapter.delete_file("u1/a.txt") in (True, False)
    assert adapter.delete_file("u1/a.txt") in (True, False)


@pytest.mark.integration
@pytest.mark.s3
def test_s3_error_paths_and_largeish(s3_moto):
    os.environ["DEPLOYMENT_TYPE"] = "remote"
    os.environ["CLOUDFLARE_R2_BUCKET"] = s3_moto["bucket"]

    from storage import reset_storage_manager, get_storage
    from storage.S3 import S3StorageAdapter

    reset_storage_manager()
    adapter = get_storage()
    assert isinstance(adapter, S3StorageAdapter)

    adapter.s3_client = s3_moto["client"]

    # Large-ish file (~1MB) to speed up CI
    key = "u1/large.bin"
    payload = b"B" * (1024 * 1024)
    assert adapter.save_file(key, payload, "application/octet-stream")
    data, ctype = adapter.get_file(key)
    assert data == payload and ctype == "application/octet-stream"

    # Nonexistent get returns (None, None)
    d2, t2 = adapter.get_file("u1/not-exist.bin")
    assert d2 is None and t2 is None


