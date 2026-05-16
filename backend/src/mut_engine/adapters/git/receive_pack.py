"""Git receive-pack parsing and publish handoff."""

from __future__ import annotations

from fastapi import HTTPException
from fastapi.responses import Response
from src.mut_engine.infrastructure.git_format import decode_commit

from src.mut_engine.adapters.git.object_quarantine import quarantine_pack
from src.mut_engine.adapters.git.protocol import (
    ZERO_ID,
    flush_pkt,
    is_object_id,
    pkt_line,
    read_pkt_lines,
)
from src.mut_engine.adapters.git.submission import submit_git_tree
from src.mut_engine.application.transaction_engine import CrossScopeSubmissionError
from src.mut_engine.server.repo_manager import MutRepoManager


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
    repo_manager: MutRepoManager,
    repo,
    project_id: str,
    scope_path: str,
    scope_excludes: list[str],
    actor: str,
    body: bytes,
    read_only: bool,
) -> Response:
    try:
        command = parse_receive_pack_request(body)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if read_only:
        return receive_pack_result(
            command.ref,
            ok=False,
            message="access point is read-only",
            capabilities=command.capabilities,
        )
    if command.ref != "refs/heads/main":
        return receive_pack_result(
            command.ref,
            ok=False,
            message="only refs/heads/main is writable",
            capabilities=command.capabilities,
        )
    if command.new_id == ZERO_ID:
        return receive_pack_result(
            command.ref,
            ok=False,
            message="delete is not supported",
            capabilities=command.capabilities,
        )

    try:
        with quarantine_pack(repo, scope_path, command.pack, roots=[command.new_id]) as quarantine:
            obj_type, commit_body = quarantine.get_object(command.new_id)
            if obj_type != "commit":
                return receive_pack_result(
                    command.ref,
                    ok=False,
                    message="new object is not a commit",
                    capabilities=command.capabilities,
                )
            commit = decode_commit(commit_body)
            tree_id = commit.get("tree", "")
            if not tree_id:
                return receive_pack_result(
                    command.ref,
                    ok=False,
                    message="commit has no tree",
                    capabilities=command.capabilities,
                )
            parents = commit.get("parents") or []
            if len(parents) > 1:
                return receive_pack_result(
                    command.ref,
                    ok=False,
                    message="client merge commits are not supported; use server-side merge",
                    capabilities=command.capabilities,
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
                proposed_files=quarantine.flatten_tree_to_bytes(tree_id),
                promote_objects=quarantine.promote_reachable,
                client_commit_id=command.new_id,
                message=commit.get("message", "") or "git push",
                scope_excludes=scope_excludes,
                defer_projection=True,
            )
        if result.status == "pending":
            return receive_pack_result(
                command.ref,
                ok=False,
                message=(
                    "conflict requires manual review on Puppyone "
                    f"(pending_conflict_id={result.pending_conflict_id})"
                ),
                capabilities=command.capabilities,
            )
    except CrossScopeSubmissionError as exc:
        return receive_pack_result(
            command.ref,
            ok=False,
            message=str(exc),
            capabilities=command.capabilities,
        )
    except Exception as exc:
        return receive_pack_result(
            command.ref,
            ok=False,
            message=f"puppyone receive failed: {exc}",
            capabilities=command.capabilities,
        )

    _ = result
    return receive_pack_result(command.ref, ok=True, message="ok", capabilities=command.capabilities)


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


def receive_pack_result(
    ref: str,
    *,
    ok: bool,
    message: str,
    capabilities: set[str] | None = None,
) -> Response:
    lines = [pkt_line(b"unpack ok\n")]
    if ok:
        lines.append(pkt_line(f"ok {ref}\n".encode("utf-8")))
    else:
        safe_message = message.replace("\n", " ")[:800]
        lines.append(pkt_line(f"ng {ref} {safe_message}\n".encode("utf-8")))
    lines.append(flush_pkt())
    content = b"".join(lines)
    if capabilities and ("side-band-64k" in capabilities or "side-band" in capabilities):
        content = pkt_line(b"\x01" + content) + flush_pkt()
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
