"""Git upload-pack/info-refs responses."""

from __future__ import annotations

from fastapi import HTTPException
from fastapi.responses import Response

from src.version_engine.adapters.git.object_quarantine import (
    GitViewCurrentCorruptError,
    receive_pack_advertisement_bare_repo,
    transport_bare_repo,
    upload_pack_bare_repo,
)
from src.version_engine.adapters.git.protocol import (
    flush_pkt,
    git_service_command,
    is_object_id,
    pkt_line,
    run_git,
)


def info_refs_response(
    repo,
    service: str,
    scope_path: str,
    scope_excludes: list[str],
) -> Response:
    if service not in {"git-upload-pack", "git-receive-pack"}:
        raise HTTPException(status_code=400, detail="unsupported git service")

    if service == "git-receive-pack":
        repo_context = receive_pack_advertisement_bare_repo(
            repo,
            scope_path,
            scope_excludes,
        )
    else:
        repo_context = transport_bare_repo(repo, scope_path, scope_excludes)

    try:
        with repo_context as bare_dir:
            advertised = run_git([
                git_service_command(service),
                "--stateless-rpc",
                "--advertise-refs",
                str(bare_dir),
            ])
    except GitViewCurrentCorruptError as exc:
        raise HTTPException(
            status_code=409,
            detail={
                "error_code": "GIT_VIEW_CURRENT_CORRUPT",
                "message": str(exc),
            },
        ) from exc
    return Response(
        content=b"".join([
            pkt_line(f"# service={service}\n".encode("ascii")),
            flush_pkt(),
            advertised,
        ]),
        media_type=f"application/x-{service}-advertisement",
        headers={"Cache-Control": "no-cache"},
    )


def upload_pack_response(
    repo,
    scope_path: str,
    scope_excludes: list[str],
    body: bytes,
) -> Response:
    try:
        with upload_pack_bare_repo(
            repo,
            scope_path,
            scope_excludes,
            wants=_upload_pack_wants(body),
        ) as bare_dir:
            output = run_git([
                "upload-pack",
                "--stateless-rpc",
                str(bare_dir),
            ], input_data=body)
    except GitViewCurrentCorruptError as exc:
        raise HTTPException(
            status_code=409,
            detail={
                "error_code": "GIT_VIEW_CURRENT_CORRUPT",
                "message": str(exc),
            },
        ) from exc
    return Response(
        content=output,
        media_type="application/x-git-upload-pack-result",
        headers={"Cache-Control": "no-cache"},
    )


def _upload_pack_wants(body: bytes) -> list[str]:
    wants: list[str] = []
    offset = 0
    while offset + 4 <= len(body):
        header = body[offset:offset + 4]
        offset += 4
        try:
            size = int(header.decode("ascii"), 16)
        except ValueError:
            break
        if size == 0:
            continue
        if size < 4:
            break
        payload_size = size - 4
        payload = body[offset:offset + payload_size]
        offset += payload_size
        if not payload.startswith(b"want "):
            continue
        parts = payload.decode("ascii", errors="ignore").strip().split()
        if len(parts) >= 2 and is_object_id(parts[1]):
            wants.append(parts[1])
    return wants
