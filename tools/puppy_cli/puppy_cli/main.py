import argparse
import json
import os
import sys
import subprocess
from datetime import datetime, timezone
from typing import Optional, Tuple

import requests


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _read_stdin_text() -> str:
    data = sys.stdin.read()
    return data


def _build_payload_text(user_text: Optional[str], assistant_text: Optional[str], stdin_text: Optional[str]) -> bytes:
    if user_text or assistant_text:
        user_part = f"User:\n{user_text or ''}".strip()
        asst_part = f"Assistant:\n{assistant_text or ''}".strip()
        payload = f"{user_part}\n\n{asst_part}\n"
        return payload.encode("utf-8")
    if stdin_text is not None:
        return stdin_text.encode("utf-8")
    raise SystemExit("No input provided. Use --user/--assistant or --from-stdin or --from-file.")


def _extract_text_from_anthropic_content(content: any) -> str:
    if isinstance(content, list):
        return "\n".join([part.get("text", "") for part in content if isinstance(part, dict)])
    return content or ""


def _normalize_messages_from_doc(doc: dict, fmt: str, full_history: bool) -> list:
    records = []
    if fmt == "cursor":
        msgs = doc.get("messages") or []
        if not full_history:
            # last user + last assistant
            if len(msgs) >= 1:
                # Allow consecutive roles; pick the last two relevant
                last_user = next((m for m in reversed(msgs) if m.get("role") == "user"), None)
                last_asst = next((m for m in reversed(msgs) if m.get("role") == "assistant"), None)
                if last_user:
                    records.append({"role": "user", "content": last_user.get("content", "")})
                if last_asst:
                    records.append({"role": "assistant", "content": last_asst.get("content", "")})
        else:
            for m in msgs:
                role = m.get("role")
                if role not in ("user", "assistant", "system"):  # keep common roles
                    continue
                records.append({"role": role, "content": m.get("content", "")})
    elif fmt == "claude":
        msgs = doc.get("messages") or []
        if not full_history:
            user_msg = next((m for m in reversed(msgs) if m.get("role") == "user"), None)
            asst_msg = next((m for m in reversed(msgs) if m.get("role") == "assistant"), None)
            if user_msg:
                records.append({"role": "user", "content": _extract_text_from_anthropic_content(user_msg.get("content"))})
            if asst_msg:
                records.append({"role": "assistant", "content": _extract_text_from_anthropic_content(asst_msg.get("content"))})
        else:
            for m in msgs:
                role = m.get("role")
                if role not in ("user", "assistant", "system"):
                    continue
                records.append({"role": role, "content": _extract_text_from_anthropic_content(m.get("content"))})
    else:
        raise SystemExit("--format must be one of: cursor, claude")
    return records


def _build_payload_structured(user_text: Optional[str], assistant_text: Optional[str], stdin_text: Optional[str], from_file: Optional[str], fmt: Optional[str], full_history: bool) -> bytes:
    records = []
    if from_file:
        with open(from_file, "r", encoding="utf-8") as f:
            doc = json.load(f)
        records = _normalize_messages_from_doc(doc, fmt or "cursor", full_history)
    else:
        if stdin_text and fmt:
            try:
                doc = json.loads(stdin_text)
                records = _normalize_messages_from_doc(doc, fmt, full_history)
            except Exception:
                # fall back to single assistant line
                pass
        if not records:
            if user_text:
                records.append({"role": "user", "content": user_text})
            if assistant_text:
                records.append({"role": "assistant", "content": assistant_text})
            if not records and stdin_text:
                records.append({"role": "assistant", "content": stdin_text})
    if not records:
        raise SystemExit("No structured content could be constructed.")
    jsonl = "\n".join(json.dumps(r, ensure_ascii=False) for r in records)
    return jsonl.encode("utf-8")


def _require_env(name: str, default: Optional[str] = None) -> str:
    val = os.getenv(name, default)
    if not val:
        raise SystemExit(f"Missing environment variable: {name}")
    return val


def _pbcopy(text: str) -> None:
    if sys.platform == "darwin":
        try:
            proc = subprocess.Popen(["pbcopy"], stdin=subprocess.PIPE)
            proc.communicate(text.encode("utf-8"))
        except Exception:
            pass


def _init_manifest(storage_base: str, token: str, block_id: str) -> Tuple[str, str, str]:
    url = f"{storage_base.rstrip('/')}/upload/chunk/direct"
    params = {
        "block_id": block_id,
        "file_name": "manifest.json",
        "content_type": "application/json",
    }
    resp = requests.post(url, params=params, data=json.dumps({"version": "1.0", "status": "generating", "chunks": [], "metadata": {}}), headers={
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    })
    if resp.status_code != 200:
        raise SystemExit(f"init manifest failed: {resp.status_code} {resp.text}")
    data = resp.json()
    return data["key"], data["version_id"], data["etag"]


def _upload_chunk(storage_base: str, token: str, block_id: str, file_name: str, content: bytes, version_id: Optional[str]) -> str:
    url = f"{storage_base.rstrip('/')}/upload/chunk/direct"
    params = {
        "block_id": block_id,
        "file_name": file_name,
        "content_type": "application/octet-stream",
    }
    if version_id:
        params["version_id"] = version_id
    resp = requests.post(url, params=params, data=content, headers={
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/octet-stream",
    })
    if resp.status_code != 200:
        raise SystemExit(f"upload chunk failed: {resp.status_code} {resp.text}")
    return resp.json().get("etag", "")


def _update_manifest(storage_base: str, token: str, user_id: str, block_id: str, version_id: str, expected_etag: str, new_chunk: dict, status: str) -> str:
    url = f"{storage_base.rstrip('/')}/upload/manifest"
    body = {
        "user_id": user_id,
        "block_id": block_id,
        "version_id": version_id,
        "expected_etag": expected_etag,
        "new_chunk": new_chunk,
        "status": status,
    }
    resp = requests.put(url, json=body, headers={
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    })
    if resp.status_code != 200:
        raise SystemExit(f"update manifest failed: {resp.status_code} {resp.text}")
    return resp.json().get("etag", expected_etag)


def cmd_push(args: argparse.Namespace) -> int:
    storage_base = os.getenv("PUPPY_STORAGE_URL", os.getenv("NEXT_PUBLIC_PUPPYSTORAGE_URL", "http://localhost:8002"))
    token = args.token or _require_env("PUPPY_API_TOKEN")

    if "/" in args.target:
        workspace_id, block_id = args.target.split("/", 1)
    else:
        workspace_id, block_id = None, args.target

    stdin_text = _read_stdin_text() if args.from_stdin else None

    if args.type == "structured":
        content = _build_payload_structured(
            args.user,
            args.assistant,
            stdin_text,
            args.from_file,
            args.format,
            args.full_history,
        )
        chunk_name = "data_0000.jsonl"
    else:
        content = _build_payload_text(args.user, args.assistant, stdin_text)
        chunk_name = "content.txt"

    manifest_key, version_id, etag = _init_manifest(storage_base, token, block_id)
    # derive user_id and block_id from key
    parts = manifest_key.split("/")
    if len(parts) < 4:
        raise SystemExit(f"invalid manifest key returned: {manifest_key}")
    user_id = parts[0]
    block_from_key = parts[1]
    if block_from_key != block_id:
        # keep using server returned one
        block_id = block_from_key

    chunk_etag = _upload_chunk(storage_base, token, block_id, chunk_name, content, version_id)
    etag = _update_manifest(storage_base, token, user_id, block_id, version_id, etag, {
        "name": chunk_name,
        "size": len(content),
        "etag": chunk_etag,
        "uploaded_at": _iso_now(),
    }, status="generating")

    # physical completed marker then manifest completed
    _upload_chunk(storage_base, token, block_id, "_completed.marker", b" ", version_id)
    _update_manifest(storage_base, token, user_id, block_id, version_id, etag, {
        "name": "_completed.marker",
        "size": 0,
        "etag": "completed",
        "uploaded_at": _iso_now(),
    }, status="completed")

    resource_key = "/".join(parts[:3])
    print(resource_key)
    if args.copy:
        _pbcopy(resource_key)
    return 0


def _ensure_dir(path: str) -> None:
    os.makedirs(path, exist_ok=True)


def cmd_record(args: argparse.Namespace) -> int:
    # Determine output directory and file
    base_dir = os.path.expanduser(args.dir or "~/.puppy/sessions")
    _ensure_dir(base_dir)
    file_name = args.file or f"session-{datetime.now().strftime('%Y%m%d-%H%M%S')}.log"
    out_path = os.path.join(base_dir, file_name)

    # Check availability of 'script'
    if not shutil.which('script'):
        print("'script' command not found. Please install util or use tmux capture.", file=sys.stderr)
        return 127

    print(f"Recording terminal session to {out_path}. Type 'exit' or Ctrl-D to stop...", file=sys.stderr)
    # Start recording; this will run an interactive subshell and return when user exits
    # -q quiet, -f flush after each write
    rc = subprocess.call(['script', '-q', '-f', out_path])
    if rc != 0:
        print(f"Recording ended with exit code {rc}", file=sys.stderr)

    print(f"Session saved: {out_path}")

    if args.auto_push:
        token = args.token or _require_env("PUPPY_API_TOKEN")
        storage_base = os.getenv("PUPPY_STORAGE_URL", os.getenv("NEXT_PUBLIC_PUPPYSTORAGE_URL", "http://localhost:8002"))
        # Read log content (truncate if huge?)
        with open(out_path, 'rb') as f:
            data = f.read()
        block_id = args.target if args.target else 'block_shell'
        manifest_key, version_id, etag = _init_manifest(storage_base, token, block_id)
        parts = manifest_key.split('/')
        if len(parts) < 3:
            raise SystemExit(f"invalid manifest key returned: {manifest_key}")
        user_id = parts[0]
        block_from_key = parts[1]
        if block_from_key != block_id:
            block_id = block_from_key

        chunk_etag = _upload_chunk(storage_base, token, block_id, 'terminal.log', data, version_id)
        etag = _update_manifest(storage_base, token, user_id, block_id, version_id, etag, {
            'name': 'terminal.log',
            'size': len(data),
            'etag': chunk_etag,
            'uploaded_at': _iso_now(),
        }, status='generating')
        _upload_chunk(storage_base, token, block_id, '_completed.marker', b' ', version_id)
        _update_manifest(storage_base, token, user_id, block_id, version_id, etag, {
            'name': '_completed.marker', 'size': 0, 'etag': 'completed', 'uploaded_at': _iso_now()
        }, status='completed')

        resource_key = "/".join(parts[:3])
        print(resource_key)
        if args.copy:
            _pbcopy(resource_key)

    return rc


def main() -> None:
    parser = argparse.ArgumentParser(prog="puppy", description="PuppyAgent CLI")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_push = sub.add_parser("push", help="Push single-turn chat to storage and print resource_key")
    p_push.add_argument("target", help="<workspace_id>/<block_id> or <block_id>")
    p_push.add_argument("--type", choices=["text", "structured"], default="structured")
    p_push.add_argument("--user", help="User message")
    p_push.add_argument("--assistant", help="Assistant message")
    p_push.add_argument("--from-stdin", action="store_true", help="Read content from stdin")
    p_push.add_argument("--from-file", help="Read chat JSON from file")
    p_push.add_argument("--format", choices=["cursor", "claude"], help="Format of --from-file or --from-stdin JSON")
    p_push.add_argument("--full-history", dest="full_history", action="store_true", help="When using --format, upload all turns instead of last pair")
    p_push.add_argument("--token", help="API token (fallback env PUPPY_API_TOKEN)")
    p_push.add_argument("--copy", action="store_true", help="Copy resource_key to clipboard on macOS")
    p_push.set_defaults(func=cmd_push)

    # record subcommand: open a recorded subshell and optionally auto-push after exit
    p_rec = sub.add_parser("record", help="Open a recorded subshell and optionally push log on exit")
    p_rec.add_argument("--dir", help="Directory to save session logs (default ~/.puppy/sessions)")
    p_rec.add_argument("--file", help="Session file name (default session-<ts>.log)")
    p_rec.add_argument("--auto-push", action="store_true", help="After exit, push the recorded log as text")
    p_rec.add_argument("--target", help="Target <workspace_id>/<block_id> or <block_id> for auto-push (default block_shell)")
    p_rec.add_argument("--token", help="API token (fallback env PUPPY_API_TOKEN)")
    p_rec.add_argument("--copy", action="store_true", help="Copy resource_key to clipboard on macOS")
    p_rec.set_defaults(func=cmd_record)

    args = parser.parse_args()
    try:
        rc = args.func(args)
    except KeyboardInterrupt:
        rc = 130
    sys.exit(rc)

if __name__ == "__main__":
    main()
