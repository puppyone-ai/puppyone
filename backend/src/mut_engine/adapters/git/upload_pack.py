"""Git upload-pack/info-refs responses."""

from __future__ import annotations

from fastapi import HTTPException
from fastapi.responses import Response

from src.mut_engine.adapters.git.object_quarantine import temporary_bare_repo
from src.mut_engine.adapters.git.protocol import (
    flush_pkt,
    git_service_command,
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

    with temporary_bare_repo(repo, scope_path, scope_excludes) as bare_dir:
        advertised = run_git([
            git_service_command(service),
            "--stateless-rpc",
            "--advertise-refs",
            str(bare_dir),
        ])
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
    with temporary_bare_repo(repo, scope_path, scope_excludes) as bare_dir:
        output = run_git([
            "upload-pack",
            "--stateless-rpc",
            str(bare_dir),
        ], input_data=body)
    return Response(
        content=output,
        media_type="application/x-git-upload-pack-result",
        headers={"Cache-Control": "no-cache"},
    )
