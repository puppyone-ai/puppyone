"""GAP-1/14: upload-pack must stream the pack, not buffer it in memory.

These lock in the streaming generator's contract:
  - it yields the git subprocess stdout in chunks,
  - it always tears down the bare-repo context and unlinks the request
    spool (success, client disconnect, or git failure),
  - a non-zero git exit is logged (status is already 200 mid-stream).
"""
from __future__ import annotations

import io
from pathlib import Path

import pytest

from src.version_engine.adapters.git import upload_pack as up
from src.version_engine.adapters.git.upload_pack import (
    _stream_upload_pack,
    _upload_pack_wants,
)
from src.version_engine.adapters.git.protocol import pkt_line, flush_pkt


class FakeCM:
    """Stand-in for the bare-repo context manager already entered."""

    def __init__(self):
        self.exited = False

    def __exit__(self, *_a):
        self.exited = True
        return False


class FakePopen:
    def __init__(self, chunks, returncode=0, **_kwargs):
        self._chunks = list(chunks)
        self.returncode = returncode
        self.stdout = io.BytesIO(b"".join(self._chunks))
        self.stderr = None
        self.killed = False
        self._done = False

    def wait(self):
        self._done = True
        return self.returncode

    def poll(self):
        return self.returncode if self._done else None

    def kill(self):
        self.killed = True
        self._done = True


@pytest.fixture
def spool(tmp_path) -> Path:
    p = tmp_path / "req"
    p.write_bytes(b"0000")  # a flush pkt; body content is irrelevant to the fake
    return p


def test_upload_pack_wants_parses_want_lines():
    oid_a = "a" * 40
    oid_b = "b" * 40
    body = (
        pkt_line(f"want {oid_a} multi_ack\n".encode())
        + pkt_line(f"want {oid_b}\n".encode())
        + flush_pkt()
        + pkt_line(b"done\n")
    )
    assert _upload_pack_wants(body) == [oid_a, oid_b]


def test_upload_pack_wants_ignores_non_want_and_bad_oids():
    body = (
        pkt_line(b"want notahex multi_ack\n")
        + pkt_line(b"have " + b"c" * 40 + b"\n")
        + flush_pkt()
    )
    assert _upload_pack_wants(body) == []


def test_stream_yields_chunks_and_tears_down(monkeypatch, spool):
    cm = FakeCM()
    fake = FakePopen([b"PACK", b"data1", b"data2"], returncode=0)
    monkeypatch.setattr(up.subprocess, "Popen", lambda *a, **k: fake)

    out = b"".join(_stream_upload_pack(cm, Path("/bare"), spool))

    assert out == b"PACKdata1data2"
    assert cm.exited is True          # context torn down
    assert not spool.exists()         # request spool unlinked
    assert fake._done is True


def test_stream_cleans_up_on_client_disconnect(monkeypatch, spool):
    cm = FakeCM()
    fake = FakePopen([b"chunk"] * 10, returncode=0)
    monkeypatch.setattr(up.subprocess, "Popen", lambda *a, **k: fake)

    gen = _stream_upload_pack(cm, Path("/bare"), spool)
    next(gen)            # start streaming, then simulate a client hang-up
    gen.close()

    assert cm.exited is True
    assert not spool.exists()
    assert fake.killed is True        # subprocess killed, not leaked


def test_stream_logs_on_git_failure(monkeypatch, spool):
    cm = FakeCM()
    fake = FakePopen([b"partial"], returncode=128)
    monkeypatch.setattr(up.subprocess, "Popen", lambda *a, **k: fake)

    logged = {}
    monkeypatch.setattr(up, "log_error", lambda msg: logged.setdefault("msg", msg))

    out = b"".join(_stream_upload_pack(cm, Path("/bare"), spool))

    assert out == b"partial"          # whatever git produced still flows
    assert "git exited 128" in logged.get("msg", "")
    assert cm.exited is True
    assert not spool.exists()
