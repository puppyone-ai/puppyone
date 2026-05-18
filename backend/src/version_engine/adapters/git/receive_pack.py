"""Git receive-pack parsing and publish handoff."""

from __future__ import annotations

from fastapi import HTTPException
from fastapi.responses import Response

from src.version_engine.adapters.git.object_quarantine import quarantine_pack
from src.version_engine.adapters.git.protocol import (
    ZERO_ID,
    flush_pkt,
    is_object_id,
    pkt_line,
    read_pkt_lines,
)
from src.version_engine.adapters.git.submission import submit_git_tree
from src.version_engine.application.git_object_format import decode_commit
from src.version_engine.application.transaction_engine import CrossScopeSubmissionError
from src.version_engine.server.repo_manager import VersionRepoManager


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
    try:
        command = parse_receive_pack_request(body)
    except ValueError as exc:
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
        with quarantine_pack(
            repo,
            scope_path,
            command.pack,
            roots=[command.new_id],
            scope_excludes=scope_excludes,
        ) as quarantine:
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
                            "use server-side merge",
                    capabilities=command.capabilities,
                )

            changed_paths = quarantine.changed_paths(command.old_id, command.new_id)
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
                base_commit_id=select_git_base_commit(
                    repo,
                    client_commit_id=command.new_id,
                    current_head_commit_id=repo.get_scope_head_commit_id(scope_path) or "",
                    quarantine=quarantine,
                ),
                proposed_tree_id=tree_id,
                changed_paths=changed_paths,
                promote_objects=quarantine.promote_reachable,
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
    except Exception as exc:
        return receive_pack_result(
            command.ref,
            outcome="rejected",
            message=f"puppyone-rejected: {exc}",
            capabilities=command.capabilities,
        )

    _ = result
    return receive_pack_result(
        command.ref, outcome="committed", message="ok",
        capabilities=command.capabilities,
    )


_LFS_POINTER_PREAMBLE = b"version https://git-lfs.github.com/spec/v1"


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


_PROTECTED_REF_PREFIXES = (
    "refs/heads/main",
    "refs/heads/master",
)
_FEATURE_REF_PATTERNS = (
    "refs/heads/feat/",
    "refs/heads/feature/",
    "refs/heads/fix/",
    "refs/heads/chore/",
    "refs/heads/refactor/",
    "refs/heads/release/",
    "refs/heads/hotfix/",
    "refs/heads/agent/",
    "refs/heads/pr/",
    "refs/heads/topic/",
)


def _ref_writability(ref: str) -> tuple[bool, str]:
    """Allow ``refs/heads/main`` plus a fixed set of conventional feature
    branch prefixes. Tags and arbitrary branch names stay rejected so a
    typo doesn't silently create a forgotten ref on the remote.

    The list is curated rather than wide-open because PuppyOne owns
    scope ownership at the *ref* boundary today — every accepted ref
    name becomes a new line in the engine's per-scope CAS map. Until
    we wire arbitrary refs through a separate ``branches`` policy
    table, this whitelist is the safe default.
    """

    if ref == "refs/heads/main":
        return True, ""
    if ref.startswith(_PROTECTED_REF_PREFIXES):
        # Other protected branch names (e.g. ``refs/heads/master``)
        # are accepted as aliases when the project has migrated.
        return True, ""
    for prefix in _FEATURE_REF_PATTERNS:
        if ref.startswith(prefix) and len(ref) > len(prefix):
            return True, ""
    if ref.startswith("refs/tags/"):
        return False, "tag refs are immutable on this remote; tag through the project API"
    return False, (
        f"ref {ref!r} is not in the writable allowlist; supported prefixes "
        "are refs/heads/main, refs/heads/feat/, refs/heads/feature/, "
        "refs/heads/fix/, refs/heads/chore/, refs/heads/refactor/, "
        "refs/heads/release/, refs/heads/hotfix/, refs/heads/agent/, "
        "refs/heads/pr/, refs/heads/topic/"
    )


def parse_receive_pack_request(body: bytes) -> ReceiveCommand:
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


def select_git_base_commit(
    repo,
    *,
    client_commit_id: str,
    current_head_commit_id: str,
    quarantine=None,
) -> str:
    """Choose the base commit represented by a Git push proposal.

    In receive-pack, the command's old_id is the server's advertised ref, not
    necessarily the commit the client branch was based on. For a forced stale
    push, using old_id as the merge base would incorrectly treat the stale tree
    as current and could drop concurrent server-side files.
    """

    if not current_head_commit_id:
        return ""
    client_ancestors = commit_ancestor_distances(
        repo,
        client_commit_id,
        quarantine=quarantine,
    )
    if current_head_commit_id in client_ancestors:
        return current_head_commit_id

    current_ancestors = commit_ancestor_distances(repo, current_head_commit_id)
    common = set(client_ancestors) & set(current_ancestors)
    if common:
        return min(
            common,
            key=lambda cid: (
                client_ancestors[cid] + current_ancestors[cid],
                client_ancestors[cid],
                current_ancestors[cid],
            ),
        )

    parents = commit_parents(repo, client_commit_id, quarantine=quarantine)
    return parents[0] if parents else ""


def commit_ancestor_distances(repo, start_commit_id: str, *, quarantine=None) -> dict[str, int]:
    if not start_commit_id:
        return {}
    distances: dict[str, int] = {}
    stack = [(start_commit_id, 0)]
    while stack:
        commit_id, distance = stack.pop()
        if not commit_id or commit_id in distances:
            continue
        distances[commit_id] = distance
        for parent in commit_parents(repo, commit_id, quarantine=quarantine):
            stack.append((parent, distance + 1))
    return distances


def commit_parents(repo, commit_id: str, *, quarantine=None) -> list[str]:
    try:
        if quarantine is not None:
            try:
                obj_type, body = quarantine.get_object(commit_id)
            except Exception:
                obj_type, body = repo.store.get_object(commit_id)
        else:
            obj_type, body = repo.store.get_object(commit_id)
        if obj_type != "commit":
            return []
        return list(decode_commit(body).get("parents") or [])
    except Exception:
        return []
