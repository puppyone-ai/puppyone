#!/usr/bin/env python3
"""Managed local Cloud development stack for PuppyOne (Rust).

Mirrors `scripts/local-cloud-dev.mjs` + `scripts/dev-electron.mjs`:
- Loads `.env` / `.env.local` from the repository root.
- Writes `target/debug/desktop-cloud.json` so direct binary / Finder "Open With"
  launches share the same local Cloud endpoints.
- Probes `http://127.0.0.1:9090/health` and `http://127.0.0.1:3000/api/health`,
  reusing already-running services or starting `uvicorn` + `next` from
  `PUPPYONE_CLOUD_DEV_ROOT` (`preview` standalone if built, otherwise `dev`).
- Validates `/login?client=desktop&desktop_state=...` before declaring ready.
- Launches `target/debug/puppy-one-rust` (unless `--services-only` is passed)
  and stops any services it started on exit.

Usage:
  python3 tools/dev-local-cloud.py                 # start local Cloud + launch Rust app
  python3 tools/dev-local-cloud.py --services-only # keep local Cloud API + Web running
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ENV_FILES = (".env", ".env.local", ".env.development", ".env.development.local")
LOOPBACK_HOSTS = {"localhost", "127.0.0.1", "::1", "[::1]"}
NO_PROXY_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def parse_env_text(source: str) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw_line in source.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[len("export ") :].strip()
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if (value.startswith('"') and value.endswith('"')) or (
            value.startswith("'") and value.endswith("'")
        ):
            value = value[1:-1]
        else:
            if " #" in value:
                value = value.split(" #", 1)[0].strip()
        values[key] = value
    return values


def load_dev_env(repo_root: Path) -> dict[str, str]:
    loaded: dict[str, str] = {}
    for name in ENV_FILES:
        path = repo_root / name
        if path.is_file():
            loaded.update(parse_env_text(path.read_text(encoding="utf-8")))
    for k, v in os.environ.items():
        loaded[k] = v
    return loaded


def find_node() -> str:
    found = shutil.which("node")
    if found:
        return found
    nvm_dir = Path.home() / ".nvm/versions/node"
    if nvm_dir.is_dir():
        candidates = sorted(nvm_dir.glob("v*/bin/node"))
        if candidates:
            return str(candidates[-1])
    for candidate in ("/opt/homebrew/bin/node", "/usr/local/bin/node"):
        if Path(candidate).is_file():
            return candidate
    raise RuntimeError("Unable to locate `node` binary for the Cloud login web app.")


def http_get(url: str, timeout: float = 3.0) -> tuple[int, str]:
    req = urllib.request.Request(url, headers={"Cache-Control": "no-store"})
    with NO_PROXY_OPENER.open(req, timeout=timeout) as resp:
        return resp.status, resp.read().decode("utf-8", errors="replace")


def probe_api(health_url: str) -> tuple[bool, str]:
    try:
        status, body = http_get(health_url, timeout=3.0)
        if status != 200:
            return False, f"HTTP {status}"
        payload = json.loads(body)
        if payload.get("status") != "ready":
            return False, f"API status is {payload.get('status')!r}"
        return True, "ready"
    except Exception as exc:
        return False, str(exc)


def probe_web(health_url: str, expected_mode: str | None) -> tuple[bool, str]:
    try:
        status, body = http_get(health_url, timeout=3.0)
        if status != 200:
            return False, f"HTTP {status}"
        payload = json.loads(body)
        if (
            payload.get("service") != "puppyone-cloud-web"
            or payload.get("status") != "ok"
            or payload.get("schemaVersion") != 1
            or not isinstance(payload.get("version"), str)
        ):
            return False, "Cloud web health identity is missing or incompatible"
        if expected_mode and payload.get("mode") != expected_mode:
            return False, f"Cloud web mode mismatch ({payload.get('mode')} != {expected_mode})"
        return True, "ready"
    except Exception as exc:
        return False, str(exc)


def verify_login_page(login_url: str) -> None:
    status, body = http_get(login_url, timeout=15.0)
    if status != 200 or "Puppyone" not in body or "Sign in" not in body:
        raise RuntimeError(f"Local Cloud login page failed startup validation ({login_url}).")


def ensure_no_proxy(env: dict[str, str]) -> dict[str, str]:
    merged = dict(env)
    loopback = "127.0.0.1,localhost,::1"
    existing = merged.get("NO_PROXY") or merged.get("no_proxy") or ""
    items = [x.strip() for x in existing.split(",") if x.strip()]
    for host in loopback.split(","):
        if host not in items:
            items.append(host)
    value = ",".join(items)
    merged["NO_PROXY"] = value
    merged["no_proxy"] = value
    return merged


def stop_children(children: list[tuple[str, subprocess.Popen]]) -> None:
    for _, proc in reversed(children):
        if proc.poll() is None:
            try:
                os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
            except ProcessLookupError:
                pass
    deadline = time.monotonic() + 5.0
    for _, proc in reversed(children):
        remaining = max(0.1, deadline - time.monotonic())
        try:
            proc.wait(timeout=remaining)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
            except ProcessLookupError:
                pass


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--services-only",
        action="store_true",
        help="Start and supervise local Cloud API + login web app without spawning a new Rust window.",
    )
    parser.add_argument(
        "--mode",
        choices=("auto", "preview", "dev"),
        default="auto",
        help="Cloud web runtime mode (`auto` uses standalone preview if built, else `next dev`).",
    )
    args, app_args = parser.parse_known_args()

    rust_root = Path(__file__).resolve().parent.parent
    repo_root = rust_root.parent
    env = ensure_no_proxy(load_dev_env(repo_root))

    api_base = env.get("VITE_DESKTOP_CLOUD_API_URL", "http://localhost:9090/api/v1").rstrip("/")
    web_origin = env.get("VITE_DESKTOP_CLOUD_WEB_URL", "http://localhost:3000").rstrip("/")
    git_origin = env.get("VITE_DESKTOP_CLOUD_GIT_ORIGIN", "http://localhost:9090").rstrip("/")

    api_url = urllib.parse.urlparse(api_base)
    web_url = urllib.parse.urlparse(web_origin)
    if api_url.hostname not in LOOPBACK_HOSTS or web_url.hostname not in LOOPBACK_HOSTS:
        raise RuntimeError("dev-local-cloud.py requires loopback API and Web URLs.")

    cloud_root_raw = env.get("PUPPYONE_CLOUD_DEV_ROOT")
    if cloud_root_raw:
        cloud_root = (repo_root / cloud_root_raw).resolve()
    else:
        qubits_candidate = (repo_root / "../puppyone-cloud-qubits").resolve()
        cloud_root = qubits_candidate if qubits_candidate.is_dir() else (repo_root / "../puppyone-cloud").resolve()

    backend_root = cloud_root / "backend"
    frontend_root = cloud_root / "frontend"
    python_bin = Path(env.get("PUPPYONE_CLOUD_BACKEND_PYTHON", str(backend_root / ".venv/bin/python")))
    standalone_js = frontend_root / ".next-desktop-login/standalone/server.js"
    next_cli = frontend_root / "node_modules/next/dist/bin/next"

    mode = args.mode
    if mode == "auto":
        mode = "preview" if standalone_js.is_file() else "dev"

    api_origin = f"{api_url.scheme}://{api_url.netloc}"
    api_host = "127.0.0.1" if api_url.hostname == "localhost" else (api_url.hostname or "127.0.0.1")
    api_port = api_url.port or 9090
    api_health = f"{api_origin}/health"

    web_host = "127.0.0.1" if web_url.hostname == "localhost" else (web_url.hostname or "127.0.0.1")
    web_port = web_url.port or 3000
    web_health = f"{web_origin}/api/health"
    login_url = f"{web_origin}/login?client=desktop&desktop_state={'a' * 43}"

    # Write `target/debug/desktop-cloud.json` so Finder Open With & direct launches match.
    target_debug = rust_root / "target/debug"
    target_debug.mkdir(parents=True, exist_ok=True)
    cloud_json = target_debug / "desktop-cloud.json"
    cloud_json.write_text(
        json.dumps({"schemaVersion": 1, "apiBase": api_base, "webOrigin": web_origin}),
        encoding="utf-8",
    )

    owned: list[tuple[str, subprocess.Popen]] = []

    def handle_signal(signum: int, _frame: object) -> None:
        stop_children(owned)
        raise SystemExit(128 + signum)

    signal.signal(signal.SIGINT, handle_signal)
    signal.signal(signal.SIGTERM, handle_signal)

    try:
        ok, _ = probe_api(api_health)
        if ok:
            print(f"[rust-dev] Reusing healthy local Cloud API at {api_origin}.", flush=True)
        else:
            if not python_bin.exists():
                raise RuntimeError(f"Local Cloud API Python venv missing: {python_bin}")
            print(f"[rust-dev] Starting local Cloud API at {api_origin} ({backend_root})...", flush=True)
            api_env = dict(env)
            api_env["FRONTEND_URL"] = web_origin
            api_env["PUBLIC_URL"] = api_origin
            api_env["PUPPYONE_PUBLIC_URL_OVERRIDE"] = api_origin
            proc = subprocess.Popen(
                [
                    str(python_bin),
                    "-m",
                    "uvicorn",
                    "src.main:app",
                    "--host",
                    api_host,
                    "--port",
                    str(api_port),
                    "--log-level",
                    "info",
                    "--no-access-log",
                ],
                cwd=str(backend_root),
                env=api_env,
                start_new_session=True,
            )
            owned.append(("API", proc))
            deadline = time.monotonic() + 60.0
            while time.monotonic() < deadline:
                if proc.poll() is not None:
                    raise RuntimeError(f"Local Cloud API exited early with code {proc.returncode}.")
                ready, _ = probe_api(api_health)
                if ready:
                    break
                time.sleep(0.5)
            else:
                raise RuntimeError(f"Timed out waiting for local Cloud API at {api_origin}.")
            print("[rust-dev] Local Cloud API is ready.", flush=True)

        ok, _ = probe_web(web_health, None)
        if ok:
            print(f"[rust-dev] Reusing healthy local Cloud login web app at {web_origin}.", flush=True)
            verify_login_page(login_url)
        else:
            node_bin = find_node()
            web_env = dict(env)
            web_env["NEXT_PUBLIC_API_URL"] = api_origin
            web_env["HOSTNAME"] = web_host
            web_env["PORT"] = str(web_port)
            if mode == "preview":
                if not standalone_js.is_file():
                    raise RuntimeError(
                        f"Standalone login server missing: {standalone_js}. Run `npm run build:local-login` or use `--mode dev`."
                    )
                web_env["NODE_ENV"] = "production"
                web_env["PUPPYONE_NEXT_DIST_DIR"] = ".next-desktop-login"
                cmd = [node_bin, "--max-old-space-size=768", str(standalone_js)]
            else:
                if not next_cli.is_file():
                    raise RuntimeError(f"Next.js CLI missing: {next_cli}")
                web_env["NODE_ENV"] = "development"
                web_env["PUPPYONE_NEXT_DIST_DIR"] = ".next"
                cmd = [
                    node_bin,
                    "--max-old-space-size=1536",
                    str(next_cli),
                    "dev",
                    "-H",
                    web_host,
                    "-p",
                    str(web_port),
                ]
            print(
                f"[rust-dev] Starting local Cloud login web app ({mode}) at {web_origin} ({frontend_root})...",
                flush=True,
            )
            proc = subprocess.Popen(
                cmd,
                cwd=str(frontend_root),
                env=web_env,
                start_new_session=True,
            )
            owned.append(("login web app", proc))
            expected_mode = "production" if mode == "preview" else "development"
            deadline = time.monotonic() + 90.0
            while time.monotonic() < deadline:
                if proc.poll() is not None:
                    raise RuntimeError(
                        f"Local Cloud login web app exited early with code {proc.returncode}."
                    )
                ready, _ = probe_web(web_health, expected_mode)
                if ready:
                    break
                time.sleep(0.5)
            else:
                raise RuntimeError(
                    f"Timed out waiting for local Cloud login web app at {web_origin}."
                )
            verify_login_page(login_url)
            print("[rust-dev] Local Cloud login web app is ready.", flush=True)

        if args.services_only:
            print(
                f"[rust-dev] Local Cloud services active ({api_base} + {web_origin}). Press Ctrl+C to stop.",
                flush=True,
            )
            while True:
                for name, proc in owned:
                    if proc.poll() is not None:
                        raise RuntimeError(
                            f"Local Cloud {name} exited unexpectedly ({proc.returncode})."
                        )
                time.sleep(2.0)

        rust_bin = target_debug / "puppy-one-rust"
        if not rust_bin.is_file():
            raise RuntimeError(f"Built binary not found at {rust_bin}. Run `cargo build` first.")
        app_env = dict(env)
        app_env["VITE_DESKTOP_CLOUD_API_URL"] = api_base
        app_env["VITE_DESKTOP_CLOUD_WEB_URL"] = web_origin
        app_env["VITE_DESKTOP_CLOUD_GIT_ORIGIN"] = git_origin
        print(f"[rust-dev] Launching {rust_bin}...", flush=True)
        app_proc = subprocess.Popen([str(rust_bin), *app_args], env=app_env)
        return app_proc.wait()
    finally:
        stop_children(owned)


if __name__ == "__main__":
    sys.exit(main())
