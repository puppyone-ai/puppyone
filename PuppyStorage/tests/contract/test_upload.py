import os
import json
import pytest


@pytest.mark.contract
@pytest.mark.asyncio
async def test_upload_init_requires_auth_header(api_client):
    # init explicitly requires Authorization, even in local mode
    payload = {
        "block_id": "blk1",
        "file_name": "a.txt",
        "content_type": "text/plain",
    }
    r = await api_client.post("/upload/init", json=payload)
    assert r.status_code == 401


@pytest.mark.contract
@pytest.mark.asyncio
async def test_upload_flow_local_complete_and_manifest(api_client):
    # Use local relaxed auth; send a dummy Bearer token to satisfy init
    headers = {"Authorization": "Bearer testtoken"}

    # 1) init
    init_req = {
        "block_id": "blk1",
        "file_name": "data.bin",
        "content_type": "application/octet-stream",
    }
    resp = await api_client.post("/upload/init", json=init_req, headers=headers)
    assert resp.status_code == 200
    init_data = resp.json()
    upload_id = init_data["upload_id"]
    key = init_data["key"]

    # 2) get upload url for part 1
    gurl_req = {"key": key, "upload_id": upload_id, "part_number": 1}
    r2 = await api_client.post("/upload/get_upload_url", json=gurl_req, headers=headers)
    assert r2.status_code == 200
    gurl = r2.json()["upload_url"]

    # The local adapter returns a server-relative URL like http://.../upload/chunk/{upload_id}/{part_number}
    # Extract path for direct call via ASGI transport
    from urllib.parse import urlparse
    p = urlparse(gurl)
    chunk_path = p.path

    # 3) upload chunk
    chunk = b"hello-world"
    r3 = await api_client.put(chunk_path, content=chunk)
    assert r3.status_code == 200
    etag = r3.json()["etag"]
    assert etag

    # 4) complete
    complete_req = {
        "key": key,
        "upload_id": upload_id,
        "parts": [{"ETag": etag, "PartNumber": 1}],
    }
    r4 = await api_client.post("/upload/complete", json=complete_req, headers=headers)
    assert r4.status_code == 200
    comp = r4.json()
    assert comp["success"] is True
    assert comp["key"] == key

    # 5) update manifest (relaxed auth path)
    manifest_req = {
        "user_id": key.split("/")[0],
        "block_id": "blk1",
        "version_id": key.split("/")[2],
        "new_chunk": {"name": "c1", "file_name": "data.bin", "size": len(chunk)},
    }
    r5 = await api_client.put("/upload/manifest", json=manifest_req, headers=headers)
    assert r5.status_code == 200
    assert r5.json()["success"] is True


@pytest.mark.contract
@pytest.mark.asyncio
async def test_upload_init_invalid_inputs(api_client):
    headers = {"Authorization": "Bearer t"}
    # invalid block_id with slash
    r1 = await api_client.post(
        "/upload/init",
        json={"block_id": "a/b", "file_name": "ok.txt", "content_type": "text/plain"},
        headers=headers,
    )
    assert r1.status_code == 422

    # invalid file_name with path traversal
    r2 = await api_client.post(
        "/upload/init",
        json={"block_id": "blk1", "file_name": "../evil.txt", "content_type": "text/plain"},
        headers=headers,
    )
    assert r2.status_code == 422


@pytest.mark.contract
@pytest.mark.asyncio
async def test_get_upload_url_invalid_key_format(api_client):
    headers = {"Authorization": "Bearer t"}
    # Prepare a valid init first
    ir = await api_client.post(
        "/upload/init",
        json={"block_id": "blk2", "file_name": "a.bin", "content_type": "application/octet-stream"},
        headers=headers,
    )
    assert ir.status_code == 200
    upload_id = ir.json()["upload_id"]

    # Use malformed key
    bad_req = {"key": "badkey", "upload_id": upload_id, "part_number": 1}
    r = await api_client.post("/upload/get_upload_url", json=bad_req, headers=headers)
    assert r.status_code == 400


@pytest.mark.contract
@pytest.mark.asyncio
async def test_upload_complete_missing_part_returns_500(api_client):
    headers = {"Authorization": "Bearer t"}
    ir = await api_client.post(
        "/upload/init",
        json={"block_id": "blk3", "file_name": "b.bin", "content_type": "application/octet-stream"},
        headers=headers,
    )
    assert ir.status_code == 200
    key = ir.json()["key"]
    upload_id = ir.json()["upload_id"]

    # Provide a non-existent part list
    r = await api_client.post(
        "/upload/complete",
        json={"key": key, "upload_id": upload_id, "parts": [{"ETag": "deadbeef", "PartNumber": 1}]},
        headers=headers,
    )
    # Current implementation returns 500 on internal errors
    assert r.status_code == 500


@pytest.mark.contract
@pytest.mark.asyncio
async def test_manifest_etag_conflict_409(api_client):
    headers = {"Authorization": "Bearer t"}

    # Create a file via direct chunk flow first
    ir = await api_client.post(
        "/upload/init",
        json={"block_id": "blk4", "file_name": "c.bin", "content_type": "application/octet-stream"},
        headers=headers,
    )
    assert ir.status_code == 200
    key = ir.json()["key"]

    # First manifest update to create the file
    version_id = key.split("/")[2]
    m1 = await api_client.put(
        "/upload/manifest",
        json={
            "user_id": key.split("/")[0],
            "block_id": "blk4",
            "version_id": version_id,
            "new_chunk": {"name": "c1", "file_name": "c.bin"},
        },
        headers=headers,
    )
    assert m1.status_code == 200
    etag = m1.json()["etag"]

    # Second update with wrong expected_etag should 409
    m2 = await api_client.put(
        "/upload/manifest",
        json={
            "user_id": key.split("/")[0],
            "block_id": "blk4",
            "version_id": version_id,
            "expected_etag": "mismatch",
            "new_chunk": {"name": "c2", "file_name": "c2.bin"},
        },
        headers=headers,
    )
    assert m2.status_code == 409


@pytest.mark.contract
@pytest.mark.asyncio
async def test_get_upload_url_forbidden_when_strict_auth(api_client, monkeypatch):
    # Enforce strict auth so ownership is checked
    os.environ["STRICT_LOCAL_AUTH"] = "true"
    headers = {"Authorization": "Bearer good_token_123456789"}

    # init produces a key with user 'local-user'
    ir = await api_client.post(
        "/upload/init",
        json={"block_id": "blk5", "file_name": "d.bin", "content_type": "application/octet-stream"},
        headers=headers,
    )
    assert ir.status_code == 200
    upload_id = ir.json()["upload_id"]

    # Craft a key belonging to another user to trigger ownership 403
    bad_key = "other-user/blk5/20200101-00000000-aaaaaa/d.bin"
    r = await api_client.post(
        "/upload/get_upload_url",
        json={"key": bad_key, "upload_id": upload_id, "part_number": 1},
        headers=headers,
    )
    assert r.status_code == 403


@pytest.mark.contract
@pytest.mark.asyncio
async def test_abort_upload_success(api_client):
    headers = {"Authorization": "Bearer t"}
    ir = await api_client.post(
        "/upload/init",
        json={"block_id": "blk6", "file_name": "e.bin", "content_type": "application/octet-stream"},
        headers=headers,
    )
    assert ir.status_code == 200
    key = ir.json()["key"]
    upload_id = ir.json()["upload_id"]

    r = await api_client.post(
        "/upload/abort",
        json={"key": key, "upload_id": upload_id},
        headers=headers,
    )
    assert r.status_code == 200
    assert r.json()["success"] is True


