"""Git object format helpers (formerly mut.foundation.git_format).

PuppyOne uses Git's loose object format as its on-disk representation, so
`puppyone fs` writes and Git client pushes both produce byte-identical
blob/tree/commit objects under the project's S3 prefix.

Object format on disk:
    zlib_compress(b"<type> <size>\\x00<content>")
    where type ∈ {blob, tree, commit} and size = len(content).

Hashing:
    SHA-1 of the uncompressed framed bytes (header + content).

Tree binary format (per entry):
    b"<mode> <name>\\x00<sha1_bytes>"
    mode is ASCII digits ("100644" file, "40000" directory),
    sha1_bytes is 20 raw bytes.

Commit text format:
    tree <sha1_hex>\\n
    parent <sha1_hex>\\n     (optional; root commits have no parent)
    author <name> <email> <ts> <tz>\\n
    committer <name> <email> <ts> <tz>\\n
    \\n
    <message>\\n
"""
from __future__ import annotations

import hashlib
import zlib
from typing import Iterable, NamedTuple


# ── object framing ────────────────────────────────────────────────

def _frame(obj_type: str, content: bytes) -> bytes:
    return f"{obj_type} {len(content)}".encode("ascii") + b"\x00" + content


def hash_object(obj_type: str, content: bytes) -> str:
    """Return the SHA-1 hex of a git object (header + content)."""
    return hashlib.sha1(_frame(obj_type, content)).hexdigest()


def encode_object(obj_type: str, content: bytes) -> tuple[str, bytes]:
    """Return (sha1_hex, zlib_compressed_loose_bytes) for storing on disk."""
    framed = _frame(obj_type, content)
    sha1 = hashlib.sha1(framed).hexdigest()
    return sha1, zlib.compress(framed)


def decode_object(loose_bytes: bytes) -> tuple[str, bytes]:
    """Decode a zlib-compressed git loose object → (type, content)."""
    framed = zlib.decompress(loose_bytes)
    nul = framed.index(b"\x00")
    header = framed[:nul].decode("ascii")
    obj_type, _size = header.split(" ", 1)
    return obj_type, framed[nul + 1:]


# ── trees ─────────────────────────────────────────────────────────

# Git uses these mode values — we only need files & directories.
MODE_FILE = b"100644"
MODE_DIR = b"40000"


class TreeEntry(NamedTuple):
    name: str
    mode: bytes        # MODE_FILE or MODE_DIR
    sha1_hex: str

    @property
    def is_dir(self) -> bool:
        return self.mode == MODE_DIR


def encode_tree(entries: Iterable[TreeEntry]) -> bytes:
    """Encode a list of TreeEntry into git tree binary format.

    Git sorts tree entries with directories suffixed by '/' for ordering;
    for plain entries we simply sort by name.
    """
    sorted_entries = sorted(
        entries,
        key=lambda e: (e.name + "/" if e.is_dir else e.name),
    )
    out = bytearray()
    for e in sorted_entries:
        out += e.mode + b" " + e.name.encode("utf-8") + b"\x00" + bytes.fromhex(e.sha1_hex)
    return bytes(out)


def decode_tree(content: bytes) -> list[TreeEntry]:
    entries: list[TreeEntry] = []
    i = 0
    while i < len(content):
        space = content.index(b" ", i)
        mode = content[i:space]
        nul = content.index(b"\x00", space)
        name = content[space + 1:nul].decode("utf-8")
        sha1_hex = content[nul + 1:nul + 21].hex()
        entries.append(TreeEntry(name=name, mode=mode, sha1_hex=sha1_hex))
        i = nul + 21
    return entries


# ── commits ───────────────────────────────────────────────────────

def encode_commit(
    tree_sha1: str,
    parent_sha1: str | None,
    author: str,
    author_time: str,
    committer: str,
    committer_time: str,
    message: str,
) -> bytes:
    """Encode a commit object body (no header)."""
    parts = [f"tree {tree_sha1}"]
    if parent_sha1:
        parts.append(f"parent {parent_sha1}")
    parts.append(f"author {author} {author_time}")
    parts.append(f"committer {committer} {committer_time}")
    parts.append("")
    parts.append(message.rstrip("\n") + "\n")
    return ("\n".join(parts)).encode("utf-8")


def decode_commit(content: bytes) -> dict:
    """Decode a commit object body into a dict."""
    text = content.decode("utf-8")
    head, _, message = text.partition("\n\n")
    info: dict = {"parents": [], "message": message.rstrip("\n")}
    for line in head.split("\n"):
        if not line:
            continue
        key, _, value = line.partition(" ")
        if key == "tree":
            info["tree"] = value
        elif key == "parent":
            info["parents"].append(value)
        elif key == "author":
            info["author"] = value
        elif key == "committer":
            info["committer"] = value
    return info


# ── helpers ───────────────────────────────────────────────────────

def split_author_line(line: str) -> tuple[str, str]:
    """Split an "author/committer" line into (identity, time_str).

    Identity format: ``Name <email>``, time string: ``<unix_ts> <tz>``.
    """
    parts = line.rsplit(" ", 2)
    if len(parts) >= 3:
        return parts[0], f"{parts[1]} {parts[2]}"
    return line, "0 +0000"
