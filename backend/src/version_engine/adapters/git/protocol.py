"""Low-level Git smart-HTTP protocol helpers."""

from __future__ import annotations

import re
import subprocess


ZERO_ID = "0" * 40
HEX_40 = re.compile(r"^[0-9a-f]{40}$")


def pkt_line(payload: bytes) -> bytes:
    return f"{len(payload) + 4:04x}".encode("ascii") + payload


def flush_pkt() -> bytes:
    return b"0000"


def read_pkt_lines(data: bytes) -> tuple[list[bytes], int]:
    payloads: list[bytes] = []
    pos = 0
    while True:
        if pos + 4 > len(data):
            raise ValueError("truncated pkt-line")
        raw_len = data[pos:pos + 4]
        pos += 4
        try:
            size = int(raw_len, 16)
        except ValueError as exc:
            raise ValueError("invalid pkt-line length") from exc
        if size == 0:
            return payloads, pos
        if size < 4:
            raise ValueError("invalid pkt-line size")
        end = pos + size - 4
        if end > len(data):
            raise ValueError("truncated pkt-line payload")
        payloads.append(data[pos:end])
        pos = end


def is_object_id(value: str) -> bool:
    return value == ZERO_ID or bool(HEX_40.match(value))


def git_service_command(service: str) -> str:
    if service == "git-receive-pack":
        return "receive-pack"
    if service == "git-upload-pack":
        return "upload-pack"
    raise ValueError(f"unsupported git service: {service}")


def run_git(
    args: list[str],
    *,
    input_data: bytes | None = None,
) -> bytes:
    proc = subprocess.run(
        ["git", *args],
        input=input_data,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if proc.returncode != 0:
        stderr = proc.stderr.decode("utf-8", errors="replace").strip()
        raise RuntimeError(stderr or f"git {' '.join(args)} failed")
    return proc.stdout
