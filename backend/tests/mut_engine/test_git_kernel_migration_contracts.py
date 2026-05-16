"""Migration guardrails for the Git-kernel refactor."""

from __future__ import annotations

import ast
import subprocess
from pathlib import Path

import pytest

from src.ingest.file.jobs.jobs import stage_blob_from_s3
from src.mut_engine.application.git_object_format import (
    MODE_DIR,
    MODE_FILE,
    TreeEntry,
    decode_commit,
    decode_object,
    decode_tree,
    encode_commit,
    encode_object,
    encode_tree,
    hash_object,
)
from src.mut_engine.application.path_utils import normalize_path


BACKEND_ROOT = Path(__file__).resolve().parents[2]


def test_git_object_helpers_match_git_hash_object() -> None:
    content = b"hello from puppyone\n"

    object_id, loose = encode_object("blob", content)
    expected = subprocess.run(
        ["git", "hash-object", "--stdin"],
        input=content,
        stdout=subprocess.PIPE,
        check=True,
    ).stdout.decode("ascii").strip()

    assert object_id == expected
    assert hash_object("blob", content) == expected
    assert decode_object(loose) == ("blob", content)


def test_git_tree_and_commit_helpers_round_trip() -> None:
    blob_id, _loose = encode_object("blob", b"data\n")
    tree_body = encode_tree([
        TreeEntry(name="src", mode=MODE_DIR, sha1_hex="1" * 40),
        TreeEntry(name="README.md", mode=MODE_FILE, sha1_hex=blob_id),
    ])

    entries = decode_tree(tree_body)
    assert [entry.name for entry in entries] == ["README.md", "src"]
    assert entries[0].sha1_hex == blob_id
    assert entries[1].is_dir

    commit_body = encode_commit(
        tree_sha1="2" * 40,
        parent_sha1="3" * 40,
        author="A <a@example.com>",
        author_time="1767225600 +0000",
        committer="C <c@example.com>",
        committer_time="1767225601 +0000",
        message="hello\n",
    )
    commit = decode_commit(commit_body)
    assert commit["tree"] == "2" * 40
    assert commit["parents"] == ["3" * 40]
    assert commit["message"] == "hello"


def test_path_normalization_is_owned_by_puppyone() -> None:
    assert normalize_path("/docs/readme.md/") == "docs/readme.md"
    assert normalize_path("") == ""
    with pytest.raises(ValueError, match="path traversal"):
        normalize_path("docs/../secret.md")


@pytest.mark.asyncio
async def test_upload_staging_writes_git_loose_blob_bytes() -> None:
    raw = b"raw upload bytes"
    source_key = "uploads/file.bin"

    class _Client:
        def head_object(self, *, Bucket, Key):
            assert Bucket == "bucket"
            assert Key == source_key
            return {"ContentLength": len(raw)}

    class _FakeS3:
        bucket_name = "bucket"

        def __init__(self):
            self.client = _Client()
            self.uploads: dict[str, bytes] = {}

        async def download_file_stream(self, key: str, chunk_size: int):
            assert key == source_key
            yield raw[:4]
            yield raw[4:]

        async def object_exists(self, key: str) -> bool:
            return key in self.uploads

        async def upload_file(self, key: str, content: bytes, content_type: str | None = None):
            assert content_type == "application/octet-stream"
            self.uploads[key] = content

    s3 = _FakeS3()
    ref = await stage_blob_from_s3(s3, project_id="project-1", src_key=source_key)

    expected_hash = hash_object("blob", raw)
    expected_key = f"mut/project-1/objects/{expected_hash[:2]}/{expected_hash[2:]}"
    assert ref.hash == expected_hash
    assert ref.size == len(raw)
    assert set(s3.uploads) == {expected_key}
    assert decode_object(s3.uploads[expected_key]) == ("blob", raw)


def test_backend_python_no_longer_imports_external_mutai() -> None:
    offenders: list[str] = []

    for root in (BACKEND_ROOT / "src", BACKEND_ROOT / "tests"):
        paths = root.rglob("*.py")
        for path in paths:
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
            for node in ast.walk(tree):
                if isinstance(node, ast.ImportFrom):
                    module = node.module or ""
                    if module == "mut" or module.startswith("mut."):
                        offenders.append(f"{path.relative_to(BACKEND_ROOT)}:{node.lineno}")
                elif isinstance(node, ast.Import):
                    for alias in node.names:
                        if alias.name == "mut" or alias.name.startswith("mut."):
                            offenders.append(f"{path.relative_to(BACKEND_ROOT)}:{node.lineno}")

    assert offenders == []


def test_core_no_longer_imports_legacy_normalize_path() -> None:
    offenders: list[str] = []

    for path in (BACKEND_ROOT / "src").rglob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if (
                isinstance(node, ast.ImportFrom)
                and node.module == "mut.core.protocol"
                and any(alias.name == "normalize_path" for alias in node.names)
            ):
                offenders.append(f"{path.relative_to(BACKEND_ROOT)}:{node.lineno}")

    assert offenders == []
