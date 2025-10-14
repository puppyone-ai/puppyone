import pytest


@pytest.mark.contract
async def test_health_ok(api_client):
    resp = await api_client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert "status" in data
    assert data.get("service") == "PuppyStorage"



