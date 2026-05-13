"""Git commit object helpers used by the transaction engine."""

from __future__ import annotations

from datetime import datetime, timezone

from mut.foundation.git_format import decode_commit, encode_commit


def format_git_time(created_at_iso: str) -> tuple[str, str]:
    """Convert ISO 8601 to Git's ``("<unix_seconds>", "<+HHMM>")`` pair."""

    try:
        dt = datetime.fromisoformat(created_at_iso.replace("Z", "+00:00"))
    except (ValueError, TypeError):
        dt = datetime.now(timezone.utc)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    ts = int(dt.timestamp())
    offset = dt.utcoffset()
    if offset is None:
        return str(ts), "+0000"
    secs = int(offset.total_seconds())
    sign = "+" if secs >= 0 else "-"
    secs = abs(secs)
    return str(ts), f"{sign}{secs // 3600:02d}{(secs % 3600) // 60:02d}"


def identity_for_git(who: str, *, domain: str = "puppyone") -> str:
    """Wrap a bare actor id in Git's ``Name <email>`` identity shape."""

    identity = (who or "anonymous").strip()
    if "<" in identity:
        return identity
    slug = identity.replace(" ", "-").lower() or "anonymous"
    return f"{identity} <{slug}@{domain}>"


def build_git_commit(
    repo,
    *,
    tree_sha: str,
    parent_sha: str,
    who: str,
    message: str,
    created_at_iso: str,
) -> str:
    """Store a real Git commit object and return its SHA-1 object id."""

    ts, tz = format_git_time(created_at_iso)
    identity = identity_for_git(who)
    commit_body = encode_commit(
        tree_sha1=tree_sha,
        parent_sha1=parent_sha or None,
        author=identity,
        author_time=f"{ts} {tz}",
        committer=identity,
        committer_time=f"{ts} {tz}",
        message=message or "(no message)",
    )
    return repo.store.put_commit(commit_body)


def commit_tree_id(repo, commit_id: str) -> str:
    """Return the tree id referenced by a stored Git commit object."""

    obj_type, content = repo.store.get_object(commit_id)
    if obj_type != "commit":
        raise ValueError(f"object {commit_id} is a {obj_type}, expected commit")
    info = decode_commit(content)
    tree_id = info.get("tree", "")
    if not tree_id:
        raise ValueError(f"commit {commit_id} has no tree")
    return tree_id
