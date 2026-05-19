"""Git receive-pack parsing and publish handoff."""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

from fastapi import HTTPException
from fastapi.responses import Response

from src.version_engine.adapters.git.object_quarantine import (
    official_receive_pack_quarantine,
)
from src.version_engine.adapters.git.protocol import (
    ZERO_ID,
    flush_pkt,
    is_object_id,
    pkt_line,
    read_pkt_lines,
)
from src.version_engine.adapters.git.submission import submit_git_tree
from src.version_engine.write_engine import tree as tree_mod
from src.version_engine.write_engine.git_object_format import (
    MODE_DIR,
    MODE_FILE,
    TreeEntry,
    decode_commit,
    encode_tree,
)
from src.version_engine.write_engine.engine import (
    CrossScopeSubmissionError,
    NonFastForwardSubmissionError,
)
from src.version_engine.write_engine.path_utils import normalize_path
from src.version_engine.write_engine.tree_objects import is_path_excluded
from src.version_engine.infrastructure.supabase.repo_manager import VersionRepoManager


class ReceiveCommand:
    def __init__(
        self,
        *,
        old_id: str,
        new_id: str,
        ref: str,
        pack: bytes,
        capabilities: set[str],
    ):
        self.old_id = old_id
        self.new_id = new_id
        self.ref = ref
        self.pack = pack
        self.capabilities = capabilities


async def receive_pack_response(
    *,
    repo_manager: VersionRepoManager,
    repo,
    project_id: str,
    scope_path: str,
    scope_excludes: list[str],
    actor: str,
    body: bytes,
    read_only: bool,
    audit_detail: dict | None = None,
) -> Response:
    tmp_name = ""
    try:
        with tempfile.NamedTemporaryFile(
            prefix="puppyone-git-receive-pack-",
            delete=False,
        ) as tmp:
            tmp.write(body)
            tmp_name = tmp.name
        return await receive_pack_response_from_path(
            repo_manager=repo_manager,
            repo=repo,
            project_id=project_id,
            scope_path=scope_path,
            scope_excludes=scope_excludes,
            actor=actor,
            request_path=Path(tmp_name),
            read_only=read_only,
            audit_detail=audit_detail,
        )
    finally:
        if tmp_name:
            try:
                os.unlink(tmp_name)
            except FileNotFoundError:
                pass


async def receive_pack_response_from_path(
    *,
    repo_manager: VersionRepoManager,
    repo,
    project_id: str,
    scope_path: str,
    scope_excludes: list[str],
    actor: str,
    request_path: Path,
    read_only: bool,
    audit_detail: dict | None = None,
) -> Response:
    try:
        command = parse_receive_pack_request_file(request_path, allow_empty=True)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if command is None:
        try:
            with official_receive_pack_quarantine(
                repo,
                scope_path,
                request_path,
                scope_excludes=scope_excludes,
            ) as official:
                return _official_receive_pack_response(official.output)
        except Exception as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    if read_only:
        return receive_pack_result(
            command.ref,
            outcome="rejected",
            message="puppyone-rejected: access point is read-only",
            capabilities=command.capabilities,
        )
    ref_allowed, ref_reason = _ref_writability(command.ref)
    if not ref_allowed:
        return receive_pack_result(
            command.ref,
            outcome="rejected",
            message=f"puppyone-rejected: {ref_reason}",
            capabilities=command.capabilities,
        )
    if command.new_id == ZERO_ID:
        return receive_pack_result(
            command.ref,
            outcome="rejected",
            message="puppyone-rejected: delete is not supported; "
                    "scope-bound history is append-only",
            capabilities=command.capabilities,
            stderr_lines=[
                "PuppyOne: refs are append-only on this remote.",
                "PuppyOne: use the rollback API to back out a commit.",
            ],
        )

    try:
        official_ref_updated = False
        with official_receive_pack_quarantine(
            repo,
            scope_path,
            request_path,
            roots=[command.new_id],
            exclude_roots=([command.old_id] if command.old_id != ZERO_ID else []),
            scope_excludes=scope_excludes,
        ) as official:
            official_ref_updated = official.ref_points_to(command.ref, command.new_id)
            if not official_ref_updated:
                try:
                    official.quarantine.get_object(command.new_id)
                except Exception:
                    if official.output:
                        return _official_receive_pack_response(official.output)
                    return receive_pack_result(
                        command.ref,
                        outcome="rejected",
                        message="puppyone-rejected: git receive-pack rejected update",
                        capabilities=command.capabilities,
                    )
            quarantine = official.quarantine
            obj_type, commit_body = quarantine.get_object(command.new_id)
            if obj_type != "commit":
                return receive_pack_result(
                    command.ref,
                    outcome="rejected",
                    message="puppyone-rejected: pushed ref must point at a commit object",
                    capabilities=command.capabilities,
                )
            commit = decode_commit(commit_body)
            tree_id = commit.get("tree", "")
            if not tree_id:
                return receive_pack_result(
                    command.ref,
                    outcome="rejected",
                    message="puppyone-rejected: commit has no tree",
                    capabilities=command.capabilities,
                )
            parents = commit.get("parents") or []
            if len(parents) > 1:
                return receive_pack_result(
                    command.ref,
                    outcome="rejected",
                    message="puppyone-rejected: client merge commits are not supported; "
                            "fetch and rebase, or resolve through PuppyOne review",
                    capabilities=command.capabilities,
                )

            changed_paths = quarantine.changed_paths(command.old_id, command.new_id)
            excluded_paths = _excluded_changed_paths(
                changed_paths,
                scope_path,
                scope_excludes,
            )
            if excluded_paths:
                return receive_pack_result(
                    command.ref,
                    outcome="rejected",
                    message=(
                        "puppyone-rejected: submission touches paths outside "
                        f"its scope or excluded paths: {', '.join(excluded_paths[:3])}"
                        f"{'…' if len(excluded_paths) > 3 else ''}"
                    ),
                    capabilities=command.capabilities,
                    stderr_lines=[
                        "PuppyOne: this push touches paths outside the scope "
                        "advertised by this remote.",
                    ],
                )

            current_scope_hash, current_head_commit_id = _get_scope_state(
                repo,
                scope_path,
            )
            expected_old_id = "" if command.old_id == ZERO_ID else command.old_id
            if (
                not scope_excludes
                and expected_old_id != (current_head_commit_id or "")
            ):
                return receive_pack_result(
                    command.ref,
                    outcome="rejected",
                    message=(
                        "puppyone-rejected: non-fast-forward update rejected"
                    ),
                    capabilities=command.capabilities,
                    stderr_lines=_NON_FAST_FORWARD_REMOTE_LINES,
                )
            if (
                not scope_excludes
                and current_head_commit_id
                and not _is_fast_forward_commit(
                    quarantine,
                    current_head_commit_id,
                    command.new_id,
                    commit,
                )
            ):
                return receive_pack_result(
                    command.ref,
                    outcome="rejected",
                    message=(
                        "puppyone-rejected: non-fast-forward update rejected"
                    ),
                    capabilities=command.capabilities,
                    stderr_lines=_NON_FAST_FORWARD_REMOTE_LINES,
                )

            promote_objects = quarantine.promote_reachable
            proposed_tree_id = tree_id
            engine_base_commit_id = expected_old_id
            if scope_excludes:
                proposed_tree_id = _canonical_tree_for_excluded_scope_push(
                    repo,
                    quarantine,
                    current_scope_hash,
                    tree_id,
                    changed_paths,
                )
                promote_objects = None
                engine_base_commit_id = current_head_commit_id

            # E5: refuse LFS pointer blobs with a clear message before the
            # publish pipeline rather than silently committing them and
            # leaving readers staring at a 200-byte pointer file. Check only
            # changed small blobs; large blobs are never read into Python for
            # this guard.
            lfs_paths = detect_lfs_pointer_blobs(
                quarantine,
                tree_id,
                changed_paths,
            )
            if lfs_paths:
                return receive_pack_result(
                    command.ref,
                    outcome="rejected",
                    message=(
                        "puppyone-rejected: Git LFS is not supported on this "
                        f"remote (LFS pointers detected at: {', '.join(lfs_paths[:3])}"
                        f"{'…' if len(lfs_paths) > 3 else ''})"
                    ),
                    capabilities=command.capabilities,
                    stderr_lines=[
                        "PuppyOne: this repository does not terminate Git LFS.",
                        "PuppyOne: disable LFS for the affected paths "
                        "(`git lfs untrack <pattern>`) and push the actual file",
                        "PuppyOne: bytes, OR use the PuppyOne object upload API "
                        "for large binaries.",
                    ],
                )

            result = await submit_git_tree(
                repo_manager,
                project_id=project_id,
                scope_path=scope_path,
                actor=actor,
                base_commit_id=engine_base_commit_id,
                proposed_tree_id=proposed_tree_id,
                changed_paths=changed_paths,
                promote_objects=promote_objects,
                client_commit_id=command.new_id,
                message=commit.get("message", "") or "git push",
                scope_excludes=scope_excludes,
                defer_projection=True,
                audit_detail={
                    "source_channel": "git",
                    "protocol": "git",
                    "service": "receive-pack",
                    "ref": command.ref,
                    "old_commit_id": command.old_id if command.old_id != ZERO_ID else "",
                    "remote_commit_id": command.new_id,
                    **(audit_detail or {}),
                },
            )
        if result.status == "pending":
            return receive_pack_result(
                command.ref,
                outcome="pending_resolution",
                message=(
                    f"puppyone-pending: review required "
                    f"(pending_conflict_id={result.pending_conflict_id})"
                ),
                capabilities=command.capabilities,
                stderr_lines=[
                    "PuppyOne: this push touched files that need manual review.",
                    f"PuppyOne: pending_conflict_id={result.pending_conflict_id}",
                    "PuppyOne: open the conflict in the PuppyOne UI to accept or "
                    "reject the resolution, then retry the push.",
                ],
            )
    except CrossScopeSubmissionError as exc:
        return receive_pack_result(
            command.ref,
            outcome="rejected",
            message=f"puppyone-rejected: {exc}",
            capabilities=command.capabilities,
            stderr_lines=[
                "PuppyOne: this push spans multiple scopes — split it across "
                "the corresponding scope remotes and retry.",
            ],
        )
    except NonFastForwardSubmissionError:
        return receive_pack_result(
            command.ref,
            outcome="rejected",
            message="puppyone-rejected: non-fast-forward update rejected",
            capabilities=command.capabilities,
            stderr_lines=_NON_FAST_FORWARD_REMOTE_LINES,
        )
    except Exception as exc:
        return receive_pack_result(
            command.ref,
            outcome="rejected",
            message=f"puppyone-rejected: {exc}",
            capabilities=command.capabilities,
        )

    _ = result
    if official_ref_updated:
        return _official_receive_pack_response(official.output)
    return receive_pack_result(
        command.ref,
        outcome="committed",
        message="puppyone-committed",
        capabilities=command.capabilities,
    )


_LFS_POINTER_PREAMBLE = b"version https://git-lfs.github.com/spec/v1"
_NON_FAST_FORWARD_REMOTE_LINES = [
    "PuppyOne: Updates were rejected because the remote contains work that "
    "you do not have locally.",
    "PuppyOne: Fetch first, then rebase your work onto origin/main before "
    "pushing again.",
    "PuppyOne: Scope remotes do not use force push as a server-side merge "
    "proposal.",
]


def _is_fast_forward_commit(
    quarantine,
    current_head_commit_id: str,
    new_commit_id: str,
    decoded_commit: dict,
) -> bool:
    if current_head_commit_id == new_commit_id:
        return True
    if current_head_commit_id in (decoded_commit.get("parents") or []):
        return True
    return quarantine.commit_is_ancestor_or_same(
        current_head_commit_id,
        new_commit_id,
    )


def detect_lfs_pointer_blobs(
    quarantine,
    tree_id: str,
    paths: list[str],
) -> list[str]:
    """Return changed paths whose content is a Git LFS pointer.

    LFS pointers are short (<200 byte) text files with a fixed first
    line. PuppyOne does NOT terminate LFS today; we reject these with
    a clear error so the client can disable LFS for this remote or
    push the actual content. Silently committing the pointer would
    leave the real bytes unreachable through ``puppyone fs cat``.
    """

    flagged: list[str] = []
    for path in paths:
        blob_id = quarantine.blob_id_for_path(tree_id, path)
        if not blob_id:
            continue
        try:
            if quarantine.object_size(blob_id) > 256:
                continue
            blob_type, content = quarantine.get_object(blob_id)
        except Exception:
            continue
        if blob_type != "blob":
            continue
        head = content[:len(_LFS_POINTER_PREAMBLE)]
        if head == _LFS_POINTER_PREAMBLE:
            flagged.append(path)
    return flagged


def _excluded_changed_paths(
    paths: list[str],
    scope_path: str,
    scope_excludes: list[str],
) -> list[str]:
    if not scope_excludes:
        return []
    scope_norm = normalize_path(scope_path)
    excludes = [normalize_path(item) for item in scope_excludes]
    rejected: list[str] = []
    for path in paths:
        rel = normalize_path(path)
        full_path = f"{scope_norm}/{rel}" if scope_norm else rel
        if is_path_excluded(full_path, excludes):
            rejected.append(path)
    return rejected


def _canonical_tree_for_excluded_scope_push(
    repo,
    quarantine,
    current_scope_hash: str,
    pushed_tree_id: str,
    changed_paths: list[str],
) -> str:
    """Merge a filtered Git view push back into the canonical scope tree.

    Access Points with excludes advertise a filtered Git view. A client's new
    commit tree therefore does not contain hidden files. Publishing that tree
    directly would drop the hidden content; comparing it to the canonical head
    as a normal Git ancestor would also reject valid visible-only changes.
    Official Git already enforced fast-forward against the filtered view, so
    here we apply only the visible changed paths onto the canonical scope tree.
    """

    quarantine.promote_reachable()
    full_blob_ids: dict[str, str] = (
        tree_mod.tree_to_flat(repo.store, current_scope_hash)
        if current_scope_hash
        else {}
    )
    for raw_path in changed_paths:
        path = normalize_path(raw_path)
        if not path:
            continue
        blob_id = quarantine.blob_id_for_path(pushed_tree_id, path)
        if blob_id:
            full_blob_ids[path] = blob_id
        else:
            full_blob_ids.pop(path, None)
    return _build_tree_from_blob_ids(repo.store, full_blob_ids)


def _build_tree_from_blob_ids(store, files: dict[str, str]) -> str:
    nested: dict = {}
    for path, blob_id in files.items():
        clean = normalize_path(path)
        if not clean or not blob_id:
            continue
        parts = [part for part in clean.split("/") if part]
        node = nested
        for part in parts[:-1]:
            node = node.setdefault(part, {})
        node[parts[-1]] = blob_id
    return _write_blob_id_tree(store, nested)


def _write_blob_id_tree(store, node: dict) -> str:
    entries: list[TreeEntry] = []
    for name, value in sorted(node.items()):
        if isinstance(value, dict):
            entries.append(TreeEntry(
                name=name,
                mode=MODE_DIR,
                sha1_hex=_write_blob_id_tree(store, value),
            ))
        else:
            entries.append(TreeEntry(name=name, mode=MODE_FILE, sha1_hex=value))
    return store.put_tree(encode_tree(entries))


def _get_scope_state(repo, scope_path: str) -> tuple[str, str]:
    get_state = getattr(repo, "get_scope_state", None)
    if callable(get_state):
        scope_hash, head_commit_id = get_state(scope_path)
        return scope_hash or "", head_commit_id or ""
    return (
        repo.get_scope_hash(scope_path) or "",
        repo.get_scope_head_commit_id(scope_path) or "",
    )


def _ref_writability(ref: str) -> tuple[bool, str]:
    """Allow only the materialized scope ref.

    PuppyOne does not yet persist separate Git branch refs for an access
    point. Accepting feature refs while publishing them to the scope head
    would look GitHub-like at the CLI boundary but mutate ``main`` under the
    hood, which is worse than a loud rejection. Keep the transport honest
    until branch/MR storage is implemented explicitly.
    """

    if ref == "refs/heads/main":
        return True, ""
    if ref.startswith("refs/tags/"):
        return False, "tag refs are immutable on this remote; tag through the project API"
    return False, (
        f"ref {ref!r} is not writable on this scope remote; "
        "only refs/heads/main is currently backed by an access-point ref"
    )


def parse_receive_pack_request(
    body: bytes,
    *,
    allow_empty: bool = False,
) -> ReceiveCommand | None:
    payloads, pack_offset = read_pkt_lines(body)
    commands: list[tuple[str, str, str]] = []
    capabilities: set[str] = set()
    for index, payload in enumerate(payloads):
        line = payload.rstrip(b"\n")
        if index == 0:
            command_line, separator, capability_line = line.partition(b"\0")
            line = command_line
            if separator:
                capabilities.update(
                    item
                    for item in capability_line.decode("ascii", errors="ignore").split()
                    if item
                )
        if line.startswith(b"shallow "):
            continue
        parts = line.decode("ascii", errors="replace").split()
        if len(parts) != 3:
            raise ValueError("malformed receive-pack command")
        old_id, new_id, ref = parts
        if not (is_object_id(old_id) and is_object_id(new_id)):
            raise ValueError("malformed object id in receive-pack command")
        commands.append((old_id, new_id, ref))

    if not commands:
        if allow_empty:
            return None
        raise ValueError("receive-pack request has no ref update")
    if len(commands) > 1:
        raise ValueError("Puppyone Git remotes accept one scope-bound ref update per push")

    old_id, new_id, ref = commands[0]
    return ReceiveCommand(
        old_id=old_id,
        new_id=new_id,
        ref=ref,
        pack=body[pack_offset:],
        capabilities=capabilities,
    )


def parse_receive_pack_request_file(
    path: Path,
    *,
    allow_empty: bool = False,
) -> ReceiveCommand | None:
    return parse_receive_pack_request(
        _read_receive_pack_header(path),
        allow_empty=allow_empty,
    )


def _read_receive_pack_header(path: Path) -> bytes:
    header = bytearray()
    with path.open("rb") as handle:
        while True:
            raw_len = handle.read(4)
            if len(raw_len) < 4:
                raise ValueError("truncated pkt-line")
            header.extend(raw_len)
            try:
                size = int(raw_len, 16)
            except ValueError as exc:
                raise ValueError("invalid pkt-line length") from exc
            if size == 0:
                return bytes(header)
            if size < 4:
                raise ValueError("invalid pkt-line size")
            payload = handle.read(size - 4)
            if len(payload) < size - 4:
                raise ValueError("truncated pkt-line payload")
            header.extend(payload)


def _official_receive_pack_response(content: bytes) -> Response:
    return Response(
        content=content,
        media_type="application/x-git-receive-pack-result",
        headers={"Cache-Control": "no-cache"},
    )


_OUTCOMES_OK = frozenset({"committed"})
_OUTCOMES_REJECTED = frozenset({"rejected", "pending_resolution"})


def receive_pack_result(
    ref: str,
    *,
    outcome: str | None = None,
    message: str,
    capabilities: set[str] | None = None,
    stderr_lines: list[str] | None = None,
) -> Response:
    """Build a receive-pack response for one of the three V1 outcomes.

    Implements 01-version-engine.md §10.3:
      * ``committed`` → standard ``ok <ref>``
      * ``rejected``  → ``ng <ref> <reason>`` (split spans / engine error)
      * ``pending_resolution`` → ``ng`` plus an explicit reason tagged so
        tooling can recognise "needs human review" vs "real reject".

    When the client negotiated ``side-band`` / ``side-band-64k``, any
    ``stderr_lines`` are emitted on channel 2 so ``git push`` prints them
    as ``remote: ...`` lines before the rejection summary.

    """

    if outcome is None:
        raise ValueError("receive_pack_result requires outcome=")

    is_ok = outcome in _OUTCOMES_OK
    if not is_ok and outcome not in _OUTCOMES_REJECTED:
        raise ValueError(f"unknown receive-pack outcome: {outcome!r}")

    report_lines = [pkt_line(b"unpack ok\n")]
    if is_ok:
        report_lines.append(pkt_line(f"ok {ref}\n".encode("utf-8")))
    else:
        safe_message = message.replace("\n", " ")[:800]
        report_lines.append(pkt_line(f"ng {ref} {safe_message}\n".encode("utf-8")))
    report_lines.append(flush_pkt())
    report_status = b"".join(report_lines)

    use_sideband = bool(
        capabilities
        and ("side-band-64k" in capabilities or "side-band" in capabilities)
    )
    if not use_sideband:
        content = report_status
    else:
        chunks: list[bytes] = []
        # Channel 2 = stderr ("remote: ..." in the git client).
        for line in stderr_lines or []:
            safe = line.replace("\n", " ")[:900]
            chunks.append(pkt_line(b"\x02" + safe.encode("utf-8") + b"\n"))
        # Channel 1 = data (the report-status payload).
        chunks.append(pkt_line(b"\x01" + report_status))
        chunks.append(flush_pkt())
        content = b"".join(chunks)

    return Response(
        content=content,
        media_type="application/x-git-receive-pack-result",
        headers={"Cache-Control": "no-cache"},
    )
