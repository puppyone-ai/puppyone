import os
import pytest


@pytest.mark.unit
def test_resolve_safe_path_prevents_traversal(tmp_path, monkeypatch):
    os.environ["DEPLOYMENT_TYPE"] = "local"
    # Point storage root to tmp for safety
    os.environ["LOCAL_STORAGE_PATH"] = str(tmp_path)

    from storage.local import LocalStorageAdapter

    adapter = LocalStorageAdapter()

    # Normal relative path allowed
    ok = adapter._resolve_safe_path("u1/b1/v1/a.txt")
    assert ok.startswith(adapter.base_path)

    # Absolute path denied
    with pytest.raises(PermissionError):
        adapter._resolve_safe_path("/etc/passwd")

    # Traversal denied
    with pytest.raises(PermissionError):
        adapter._resolve_safe_path("../../secret")


@pytest.mark.unit
def test_calculate_etag(tmp_path):
    from storage.local import LocalStorageAdapter

    adapter = LocalStorageAdapter()
    p = tmp_path / "x.bin"
    p.write_bytes(b"abc")
    etag = adapter._calculate_etag(str(p))
    # MD5("abc")
    assert etag == "900150983cd24fb0d6963f7d28e17f72"


