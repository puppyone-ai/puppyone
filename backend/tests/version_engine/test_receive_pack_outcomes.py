"""Unit tests for the V1 receive-pack outcome reporting (E1).

These exercise ``receive_pack_result`` directly so we don't depend on a
real ``git`` binary — those flow tests live in
``test_real_git_cli_*`` and are skipped on Windows.

What we verify:
  * outcome=``committed``   → unpack ok + ``ok <ref>`` + flush
  * outcome=``rejected``    → unpack ok + ``ng <ref> <reason>`` + flush
  * outcome=``pending_resolution`` → ``ng`` with the puppyone-pending tag
    AND side-band channel-2 ``PuppyOne: ...`` stderr lines so ``git push``
    surfaces the resolver hint.
  * unknown outcomes raise ValueError (parser invariant).
"""

from __future__ import annotations

import pytest

from src.version_engine.adapters.git.receive_pack import receive_pack_result


REF = "refs/heads/main"


def _decode_pkt_lines(body: bytes) -> list[bytes]:
    """Split a pkt-line stream into payloads. Flush packets become b''."""
    out: list[bytes] = []
    i = 0
    while i < len(body):
        size_hex = body[i:i + 4]
        if size_hex == b"0000":
            out.append(b"")
            i += 4
            continue
        size = int(size_hex, 16)
        out.append(body[i + 4:i + size])
        i += size
    return out


# ── outcome semantics ─────────────────────────────────────────


def test_committed_outcome_emits_ok_line():
    resp = receive_pack_result(REF, outcome="committed", message="ok")
    body = resp.body
    assert b"unpack ok" in body
    assert f"ok {REF}".encode() in body
    assert b"ng" not in body


def test_rejected_outcome_emits_ng_with_reason():
    resp = receive_pack_result(REF, outcome="rejected", message="puppyone-rejected: nope")
    body = resp.body
    assert b"unpack ok" in body
    assert f"ng {REF} puppyone-rejected: nope".encode() in body


def test_pending_resolution_outcome_is_tagged_for_tooling():
    resp = receive_pack_result(
        REF,
        outcome="pending_resolution",
        message="puppyone-pending: review required (pending_conflict_id=abc123)",
    )
    body = resp.body
    # The ng line carries the structured tag so tooling can disambiguate
    # a real reject from a "needs review" pending row.
    assert b"puppyone-pending" in body
    assert b"pending_conflict_id=abc123" in body


def test_unknown_outcome_raises():
    with pytest.raises(ValueError, match="unknown receive-pack outcome"):
        receive_pack_result(REF, outcome="weird", message="x")


def test_missing_outcome_raises():
    with pytest.raises(ValueError, match="outcome="):
        receive_pack_result(REF, message="x")


# ── side-band stderr ──────────────────────────────────────────


def test_side_band_emits_channel_2_for_stderr_lines():
    resp = receive_pack_result(
        REF,
        outcome="pending_resolution",
        message="puppyone-pending: review required",
        capabilities={"side-band-64k"},
        stderr_lines=[
            "PuppyOne: this push touched files that need manual review.",
            "PuppyOne: pending_conflict_id=abc123",
        ],
    )
    body = resp.body
    # When side-band is in use, channel-2 lines start with the 0x02 byte
    # inside the pkt-line payload (the git client maps them to stderr).
    assert b"\x02PuppyOne: this push" in body
    assert b"\x02PuppyOne: pending_conflict_id=abc123" in body
    # The report-status (unpack ok + ng) rides channel 1.
    assert b"\x01" in body


def test_no_side_band_skips_stderr_lines():
    """Clients that didn't negotiate side-band only get the report-status."""
    resp = receive_pack_result(
        REF,
        outcome="rejected",
        message="puppyone-rejected: split your push",
        capabilities=set(),  # no side-band
        stderr_lines=["PuppyOne: split your push across scope remotes"],
    )
    body = resp.body
    assert b"unpack ok" in body
    assert b"PuppyOne:" not in body  # stderr lines suppressed
    assert f"ng {REF} puppyone-rejected: split your push".encode() in body


def test_committed_can_also_emit_side_band_hints():
    resp = receive_pack_result(
        REF,
        outcome="committed",
        message="ok",
        capabilities={"side-band-64k"},
        stderr_lines=["PuppyOne: published 1 commit"],
    )
    body = resp.body
    assert b"\x02PuppyOne: published 1 commit" in body
    assert b"\x01" in body  # report status on data channel
    assert f"ok {REF}".encode() in body


# ── newlines are squashed so a stray \n can't smuggle a fake pkt ────


def test_message_newlines_are_collapsed():
    """Defense-in-depth: a user/system-supplied error message must not be
    able to inject an extra report-status pkt-line via embedded \\n."""
    resp = receive_pack_result(
        REF,
        outcome="rejected",
        message="line1\nline2\nline3",
    )
    payloads = _decode_pkt_lines(resp.body)
    ng_payloads = [p for p in payloads if p.startswith(b"ng ")]
    assert len(ng_payloads) == 1
    assert b"\n" not in ng_payloads[0].rstrip(b"\n")
