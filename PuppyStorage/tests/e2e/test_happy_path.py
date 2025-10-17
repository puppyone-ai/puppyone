import os
import time
import pytest
import requests


@pytest.mark.e2e
def test_happy_path_end_to_end():
    # Expect docker-compose.e2e.yml to be up
    base = os.environ.get("PUPPYSTORAGE_URL", "http://localhost:8002")

    # health
    r = requests.get(f"{base}/health")
    assert r.status_code == 200

    # auth mocked via wiremock; strict auth not required for e2e
    headers = {"Authorization": "Bearer token"}

    # init
    ir = requests.post(
        f"{base}/upload/init",
        json={"block_id": "blk", "file_name": "a.txt", "content_type": "text/plain"},
        headers=headers,
        timeout=10,
    )
    assert ir.status_code == 200
    key = ir.json()["key"]
    upload_id = ir.json()["upload_id"]

    # get url & upload
    ur = requests.post(
        f"{base}/upload/get_upload_url",
        json={"key": key, "upload_id": upload_id, "part_number": 1},
        headers=headers,
        timeout=10,
    )
    assert ur.status_code == 200
    import urllib.parse as up

    p = up.urlparse(ur.json()["upload_url"])  # for local storage this points to storage server
    # upload chunk
    put = requests.put(f"{base}{p.path}", data=b"hello")
    assert put.status_code == 200
    etag = put.json()["etag"]

    # complete
    cr = requests.post(
        f"{base}/upload/complete",
        json={"key": key, "upload_id": upload_id, "parts": [{"ETag": etag, "PartNumber": 1}]},
        headers=headers,
        timeout=10,
    )
    assert cr.status_code == 200

    # manifest update
    mr = requests.put(
        f"{base}/upload/manifest",
        json={
            "user_id": key.split("/")[0],
            "block_id": "blk",
            "version_id": key.split("/")[2],
            "new_chunk": {"name": "c1", "file_name": "a.txt"},
        },
        headers=headers,
        timeout=10,
    )
    assert mr.status_code == 200

    # download url
    dr = requests.get(f"{base}/download/url", params={"key": key}, headers=headers, timeout=10)
    assert dr.status_code == 200
    durl = dr.json()["download_url"]
    # stream download
    dl = requests.get(durl if durl.startswith("http") else f"{base}{durl}")
    assert dl.status_code in (200, 206)
    assert dl.content.startswith(b"h")


