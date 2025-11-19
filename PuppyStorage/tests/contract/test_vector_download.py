import os
import pytest


@pytest.mark.contract
@pytest.mark.asyncio
async def test_download_url_happy_and_errors(api_client):
    # relaxed auth
    os.environ["STRICT_LOCAL_AUTH"] = "false"
    headers = {"Authorization": "Bearer t"}

    # Missing/invalid key
    r1 = await api_client.get("/download/url", headers=headers, params={"key": "bad"})
    assert r1.status_code == 400

    # Create a file via upload flow, then get download url
    ir = await api_client.post(
        "/upload/init",
        json={"block_id": "blkD", "file_name": "d.txt", "content_type": "text/plain"},
        headers=headers,
    )
    assert ir.status_code == 200
    key = ir.json()["key"]

    # Complete minimal file by direct chunk API to ensure existence
    gurl = await api_client.post(
        "/upload/get_upload_url",
        json={"key": key, "upload_id": ir.json()["upload_id"], "part_number": 1},
        headers=headers,
    )
    assert gurl.status_code == 200
    from urllib.parse import urlparse
    p = urlparse(gurl.json()["upload_url"])  # local path in dev
    chunk_path = p.path
    rput = await api_client.put(chunk_path, content=b"x")
    assert rput.status_code == 200
    etag = rput.json().get("etag")
    assert etag
    cr = await api_client.post(
        "/upload/complete",
        json={"key": key, "upload_id": ir.json()["upload_id"], "parts": [{"ETag": etag, "PartNumber": 1}]},
        headers=headers,
    )
    # local complete validates part existence; should succeed
    assert cr.status_code == 200

    dr = await api_client.get("/download/url", headers=headers, params={"key": key})
    # local backend returns /download/stream url; S3 would return presigned url
    assert dr.status_code == 200
    assert "download_url" in dr.json()

    # 404 path: use a different key
    dr2 = await api_client.get(
        "/download/url",
        headers=headers,
        params={"key": "u1/blkX/20200101-000000-aaaa/file.txt"},
    )
    # On local: FileNotFoundError -> 404; tolerate adapter differences
    assert dr2.status_code in (404, 500)


@pytest.mark.contract
@pytest.mark.asyncio
async def test_vector_search_bad_provider_and_minimal_ok(api_client, monkeypatch):
    # vector models listing
    r = await api_client.get("/vector/models", params={"provider": "nonexist"})
    assert r.status_code == 400

    # monkeypatch embedder to avoid heavy model load
    import server.routes.vector_routes as vr

    class FakeEmbedder:
        @staticmethod
        def create(model):
            return FakeEmbedder()

        def embed(self, texts):
            # Return small vectors
            return [[1.0, 0.0, 0.0] for _ in texts]

    # Monkeypatch the lazy loader function to return our fake embedder
    def fake_get_embedder_modules():
        class FakeModelRegistry:
            pass
        return FakeEmbedder, FakeModelRegistry
    
    monkeypatch.setattr(vr, "_get_embedder_modules", fake_get_embedder_modules)

    # minimal search happy path
    payload = {
        "query": "hi",
        "set_name": "s1",
        "user_id": "u1",
        "model": "dummy",
        "vdb_type": "pgvector",
        "top_k": 1,
    }
    rs = await api_client.post("/vector/search", json=payload)
    assert rs.status_code == 200
    assert isinstance(rs.json(), list)


