"""FlyMachinesProvider tests with a mocked httpx transport."""

from __future__ import annotations

import json

import httpx
import pytest

from src.platform.scope_sandbox.fly_provider import FlyMachinesProvider
from src.platform.scope_sandbox.provider import SandboxSpec, SandboxState


def _provider(handler):
    client = httpx.AsyncClient(
        transport=httpx.MockTransport(handler), base_url="https://api.machines.dev",
    )
    return FlyMachinesProvider("myapp", "tok", client=client, default_image="img:latest")


def _spec():
    return SandboxSpec(scope_id="s1", project_id="p1", vcpus=2, memory_mb=2048, region="ams")


async def test_create_posts_machine_and_returns_running():
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"id": "m1", "instance_id": "i1", "state": "started"})

    info = await _provider(handler).create(_spec())

    assert info.sandbox_id == "m1"
    assert info.state is SandboxState.RUNNING
    assert info.connection.host == "myapp.fly.dev" and info.connection.port == 22

    req = seen[0]
    assert req.method == "POST"
    assert req.url.path == "/v1/apps/myapp/machines"
    assert req.headers["authorization"] == "Bearer tok"
    body = json.loads(req.content)
    assert body["region"] == "ams"
    assert body["config"]["image"] == "img:latest"
    assert body["config"]["guest"]["cpus"] == 2
    # sshd internal 2222 exposed as public TCP 22
    svc = body["config"]["services"][0]
    assert svc["protocol"] == "tcp" and svc["internal_port"] == 2222
    assert svc["ports"][0]["port"] == 22


async def test_create_waits_when_not_started():
    paths: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        paths.append(request.url.path)
        if request.url.path.endswith("/wait"):
            assert request.url.params["state"] == "started"
            return httpx.Response(200, json={"ok": True})
        return httpx.Response(200, json={"id": "m1", "instance_id": "i1", "state": "created"})

    info = await _provider(handler).create(_spec())
    assert info.state is SandboxState.RUNNING
    assert any(p.endswith("/wait") for p in paths)  # waited for "started"


async def test_start_stop_destroy_hit_right_endpoints():
    seen: list[tuple[str, str]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append((request.method, request.url.path))
        return httpx.Response(200, json={})

    prov = _provider(handler)
    assert (await prov.start("m1")).state is SandboxState.RUNNING
    assert (await prov.stop("m1")).state is SandboxState.STOPPED
    await prov.destroy("m1")

    assert ("POST", "/v1/apps/myapp/machines/m1/start") in seen
    assert ("POST", "/v1/apps/myapp/machines/m1/stop") in seen
    assert ("DELETE", "/v1/apps/myapp/machines/m1") in seen


@pytest.mark.parametrize(
    "fly_state,expected",
    [
        ("started", SandboxState.RUNNING),
        ("stopped", SandboxState.STOPPED),
        ("suspended", SandboxState.STOPPED),
        ("destroyed", SandboxState.DESTROYED),
        ("starting", SandboxState.PENDING),
        ("weird", SandboxState.UNKNOWN),
    ],
)
async def test_status_maps_states(fly_state, expected):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"id": "m1", "state": fly_state})

    assert (await _provider(handler).status("m1")).state is expected


async def test_status_404_is_destroyed_and_destroy_404_swallowed():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={"error": "not found"})

    prov = _provider(handler)
    assert (await prov.status("gone")).state is SandboxState.DESTROYED
    await prov.destroy("gone")  # 404 on delete must not raise


def test_capabilities():
    caps = _provider(lambda r: httpx.Response(200, json={})).capabilities()
    assert caps.name == "fly"
    assert caps.supports_stop_resume and caps.supports_tcp_ingress
    assert not caps.self_hostable
