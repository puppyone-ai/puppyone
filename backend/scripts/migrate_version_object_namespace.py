#!/usr/bin/env python
"""Copy Version Engine Git objects from the deferred S3 prefix to the final prefix.

This is an explicit deployment/cutover tool, not a runtime compatibility path.
It repairs environments that still have canonical Git objects under the
pre-final storage namespace by server-side copying them to the final
``version/...`` object namespace and updating packed-object location rows.

Dry-run is the default. Pass ``--execute`` to mutate S3/Postgres.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from dataclasses import asdict, dataclass
from pathlib import Path

from dotenv import load_dotenv

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from src.infra.s3.service import S3Service
from src.infra.supabase.client import SupabaseClient
from src.version_engine.infrastructure.supabase import safe_data
from src.version_engine.infrastructure.supabase.db_names import OBJECT_LOCATIONS_TABLE


_FINAL_NAMESPACE = "version"
_DEFERRED_NAMESPACE = "".join(("m", "ut"))


@dataclass
class ProjectMigrationSummary:
    project_id: str
    execute: bool
    loose_seen: int = 0
    loose_copied: int = 0
    loose_skipped_existing: int = 0
    bundles_seen: int = 0
    bundles_copied: int = 0
    bundles_skipped_existing: int = 0
    pack_rows_seen: int = 0
    pack_rows_updated: int = 0


def _new_key_for_old_project_key(project_id: str, key: str) -> str:
    old_prefix = f"{_DEFERRED_NAMESPACE}/{project_id}/"
    if not key.startswith(old_prefix):
        raise ValueError(f"key is outside deferred project namespace: {key}")
    return f"{_FINAL_NAMESPACE}/{project_id}/{key[len(old_prefix):]}"


async def _iter_keys(s3: S3Service, *, prefix: str, page_size: int):
    token: str | None = None
    while True:
        files, _prefixes, token, truncated = await s3.list_files(
            prefix=prefix,
            max_keys=page_size,
            continuation_token=token,
        )
        for item in files:
            yield item.key
        if not truncated or not token:
            return


async def _copy_prefix(
    *,
    s3: S3Service,
    project_id: str,
    old_prefix: str,
    execute: bool,
    page_size: int,
    concurrency: int,
    kind: str,
    skip_existing: bool,
    summary: ProjectMigrationSummary,
) -> None:
    sem = asyncio.Semaphore(concurrency)

    async def copy_one(src_key: str) -> None:
        dst_key = _new_key_for_old_project_key(project_id, src_key)
        exists = await s3.object_exists(dst_key) if skip_existing else False
        if kind == "loose":
            summary.loose_seen += 1
            if exists:
                summary.loose_skipped_existing += 1
                return
        else:
            summary.bundles_seen += 1
            if exists:
                summary.bundles_skipped_existing += 1
                return

        if execute:
            await s3.copy_object(
                src_key,
                dst_key,
                content_type="application/octet-stream",
            )
        if kind == "loose":
            summary.loose_copied += 1
        else:
            summary.bundles_copied += 1

    pending: set[asyncio.Task[None]] = set()
    async for key in _iter_keys(s3, prefix=old_prefix, page_size=page_size):
        async def run(k: str = key) -> None:
            async with sem:
                await copy_one(k)

        pending.add(asyncio.create_task(run()))
        if len(pending) >= concurrency * 4:
            done, pending = await asyncio.wait(
                pending,
                return_when=asyncio.FIRST_COMPLETED,
            )
            for task in done:
                task.result()

    if pending:
        for task in await asyncio.gather(*pending):
            _ = task


def _load_old_pack_rows(client, project_id: str, *, page_size: int) -> list[dict]:
    rows: list[dict] = []
    start = 0
    old_prefix = f"{_DEFERRED_NAMESPACE}/{project_id}/object-bundles/%"
    while True:
        resp = (
            client.table(OBJECT_LOCATIONS_TABLE)
            .select("object_id, pack_key")
            .eq("project_id", project_id)
            .like("pack_key", old_prefix)
            .range(start, start + page_size - 1)
            .execute()
        )
        page = safe_data(resp) or []
        rows.extend(page)
        if len(page) < page_size:
            return rows
        start += page_size


async def _update_pack_rows(
    *,
    client,
    project_id: str,
    execute: bool,
    page_size: int,
    summary: ProjectMigrationSummary,
) -> None:
    rows = _load_old_pack_rows(client, project_id, page_size=page_size)
    summary.pack_rows_seen = len(rows)
    if not execute:
        summary.pack_rows_updated = len(rows)
        return

    for row in rows:
        object_id = str(row.get("object_id") or "")
        old_pack_key = str(row.get("pack_key") or "")
        if not object_id or not old_pack_key:
            continue
        new_pack_key = _new_key_for_old_project_key(project_id, old_pack_key)
        (
            client.table(OBJECT_LOCATIONS_TABLE)
            .update({"pack_key": new_pack_key})
            .eq("project_id", project_id)
            .eq("object_id", object_id)
            .execute()
        )
        summary.pack_rows_updated += 1


async def migrate_project(
    project_id: str,
    *,
    s3: S3Service,
    supabase: SupabaseClient,
    execute: bool,
    page_size: int,
    concurrency: int,
    skip_existing: bool,
) -> ProjectMigrationSummary:
    summary = ProjectMigrationSummary(project_id=project_id, execute=execute)
    await _copy_prefix(
        s3=s3,
        project_id=project_id,
        old_prefix=f"{_DEFERRED_NAMESPACE}/{project_id}/objects/",
        execute=execute,
        page_size=page_size,
        concurrency=concurrency,
        kind="loose",
        skip_existing=skip_existing,
        summary=summary,
    )
    await _copy_prefix(
        s3=s3,
        project_id=project_id,
        old_prefix=f"{_DEFERRED_NAMESPACE}/{project_id}/object-bundles/",
        execute=execute,
        page_size=page_size,
        concurrency=concurrency,
        kind="bundle",
        skip_existing=skip_existing,
        summary=summary,
    )
    await _update_pack_rows(
        client=supabase.client,
        project_id=project_id,
        execute=execute,
        page_size=page_size,
        summary=summary,
    )
    return summary


def _load_all_project_ids(client, *, page_size: int) -> list[str]:
    ids: list[str] = []
    start = 0
    while True:
        resp = (
            client.table("projects")
            .select("id")
            .order("created_at")
            .range(start, start + page_size - 1)
            .execute()
        )
        page = safe_data(resp) or []
        ids.extend(str(row["id"]) for row in page if row.get("id"))
        if len(page) < page_size:
            return ids
        start += page_size


async def _amain() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-id", action="append", default=[])
    parser.add_argument("--all-projects", action="store_true")
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--page-size", type=int, default=1000)
    parser.add_argument("--concurrency", type=int, default=20)
    parser.add_argument(
        "--skip-existing",
        action="store_true",
        help=(
            "HEAD destination keys before copying. Slower, but reports skipped "
            "counts. By default copy is overwrite-idempotent and avoids HEAD."
        ),
    )
    parser.add_argument(
        "--env-file",
        default=str(Path(__file__).resolve().parents[1] / ".env"),
    )
    args = parser.parse_args()

    load_dotenv(args.env_file)

    supabase = SupabaseClient()
    project_ids = list(dict.fromkeys(args.project_id))
    if args.all_projects:
        project_ids.extend(_load_all_project_ids(supabase.client, page_size=args.page_size))
        project_ids = list(dict.fromkeys(project_ids))
    if not project_ids:
        parser.error("pass --project-id at least once, or --all-projects")

    s3 = S3Service()
    summaries = []
    for project_id in project_ids:
        summaries.append(
            await migrate_project(
                project_id,
                s3=s3,
                supabase=supabase,
                execute=args.execute,
                page_size=args.page_size,
                concurrency=args.concurrency,
                skip_existing=args.skip_existing,
            )
        )

    print(json.dumps([asdict(item) for item in summaries], indent=2, sort_keys=True))
    return 0


def main() -> int:
    return asyncio.run(_amain())


if __name__ == "__main__":
    raise SystemExit(main())
