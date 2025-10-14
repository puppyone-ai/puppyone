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


