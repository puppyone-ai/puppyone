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


