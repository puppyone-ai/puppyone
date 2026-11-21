#!/usr/bin/env python3
"""End-to-end Linux `.deb` + `.AppImage` packaging, installation, PDFium layout,
and headless launch + CLI Unix-socket handshake smoke test.

Intended for Linux CI (`ubuntu-22.04` and `ubuntu-24.04`):
  1. Packages `.deb`, `.AppImage`, `SHA256SUMS.txt`, and `internal-linux.yml`
     via `tools/release/package.py --target linux --channel internal`
     (which builds `cargo build --release --locked` with `PUPPYONE_LINUX_RELEASE_MARKER`).
  2. Verifies `SHA256SUMS.txt` checksums.
  3. Installs the `.deb` via `sudo dpkg -i`, asserts `/usr/bin/puppy-one-rust`,
     `/usr/lib/puppyone/libpdfium.so`, and `.desktop` entry exist, checks
     `--puppyone-build-info`, launches under `xvfb-run` with `--puppyone-cli-launch`,
     and verifies the CLI Unix-socket `hello` handshake + clean exit.
  4. Removes the `.deb` via `sudo dpkg -r puppyone-internal`.
  5. Verifies the `.AppImage` bundles `usr/lib/libpdfium.so`, runs
     `--appimage-extract-and-run --puppyone-build-info`, launches under
     `xvfb-run` with `--appimage-extract-and-run --puppyone-cli-launch`, and
     verifies the CLI Unix-socket `hello` handshake + clean exit.
"""
import hashlib
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]


def run(cmd, *, cwd=ROOT, env=None, check=True, capture=False):
    print(f"+ {' '.join(str(c) for c in cmd)}", flush=True)
    return subprocess.run(
        [str(c) for c in cmd],
        cwd=str(cwd),
        env=env,
        check=check,
        text=True,
        capture_output=capture,
    )


def cli_socket_path(data_dir: Path) -> Path:
    preferred = data_dir / "cli" / "control.sock"
    if len(str(preferred)) <= 103:
        return preferred
    digest = hashlib.sha256(str(data_dir).encode("utf-8")).hexdigest()[:16]
    return Path("/tmp") / f"puppyone-cli-{os.getuid()}" / f"{digest}.sock"


def unix_socket_hello(data_dir: Path, timeout_s: float = 25.0) -> dict:
    sock_path = cli_socket_path(data_dir)
    deadline = time.monotonic() + timeout_s
    last_err = None
    while time.monotonic() < deadline:
        if sock_path.exists():
            s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            s.settimeout(5.0)
            try:
                s.connect(str(sock_path))
                s.sendall(b'{"protocol":1,"type":"hello"}\n')
                s.shutdown(socket.SHUT_WR)
                chunks = bytearray()
                while True:
                    data = s.recv(4096)
                    if not data:
                        break
                    chunks.extend(data)
                return json.loads(chunks.decode("utf-8").strip())
            except OSError as exc:
                last_err = exc
            finally:
                s.close()
        time.sleep(0.15)
    raise TimeoutError(f"Timed out waiting for Linux CLI socket {sock_path}: {last_err}")


def launch_and_verify_cli_hello(cmd: list[str], label: str, expected_version: str) -> None:
    data_dir = Path(tempfile.mkdtemp(prefix="po-cli-", dir="/tmp"))
    try:
        env = {
            **os.environ,
            "PUPPYONE_RUST_DATA_DIR": str(data_dir),
            "XDG_RUNTIME_DIR": str(data_dir),
            "LIBGL_ALWAYS_SOFTWARE": "1",
        }
        full_cmd = ["xvfb-run", "-a", *cmd, "--puppyone-cli-launch"]
        print(f"+ {' '.join(full_cmd)}", flush=True)
        proc = subprocess.Popen(
            full_cmd,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        try:
            reply = unix_socket_hello(data_dir)
            print(f"[{label}] CLI hello reply: {reply}", flush=True)
            assert reply["ok"] is True, reply
            assert reply["protocol"] == 1, reply
            assert reply["app"]["version"] == expected_version, reply
            assert reply["app"]["channel"] == "internal", reply
            out, err = proc.communicate(timeout=20)
            assert proc.returncode == 0, f"[{label}] exited {proc.returncode}: stdout={out} stderr={err}"
        finally:
            if proc.poll() is None:
                proc.terminate()
                try:
                    proc.communicate(timeout=10)
                except subprocess.TimeoutExpired:
                    proc.kill()
    finally:
        shutil.rmtree(data_dir, ignore_errors=True)


def main() -> None:
    if sys.platform != "linux":
        raise SystemExit("smoke_linux_packages.py must run on Linux")

    work = Path(tempfile.mkdtemp(prefix="puppyone-linux-smoke-"))
    deb_installed = False
    try:
        pkg_env = {
            **os.environ,
            "VITE_DESKTOP_CLOUD_API_URL": "https://api.puppyone.ai/api/v1",
            "VITE_DESKTOP_CLOUD_WEB_URL": "https://puppyone.ai",
        }
        out_dir = work / "out"
        run(
            [
                sys.executable,
                "tools/release/package.py",
                "--target",
                "linux",
                "--channel",
                "internal",
                "--build-number",
                "100",
                "--base-version",
                "0.4.90",
                "--update-feed-url",
                "https://updates.puppyone.ai/desktop/internal/linux/latest",
                "--out",
                str(out_dir),
            ],
            env=pkg_env,
        )

        release_dir = out_dir / "internal"
        expected_version = "0.4.90-internal.100"
        deb_file = next(release_dir.glob("puppyone-*.deb"))
        appimage_file = next(release_dir.glob("puppyone-*.AppImage"))
        assert (release_dir / "internal-linux.yml").is_file(), "missing internal-linux.yml"
        assert (release_dir / "SHA256SUMS.txt").is_file(), "missing SHA256SUMS.txt"

        # Verify checksums.
        run(["sha256sum", "-c", "SHA256SUMS.txt"], cwd=release_dir)

        # 1. Install and smoke-test .deb package.
        run(["sudo", "dpkg", "-i", str(deb_file)])
        deb_installed = True
        assert Path("/usr/bin/puppy-one-rust").is_file()
        assert Path("/usr/lib/puppyone/libpdfium.so").is_file(), "PDFium missing in .deb install"
        assert Path("/usr/share/applications/ai.puppyone.desktop.internal.desktop").is_file()

        deb_info = json.loads(
            run(["/usr/bin/puppy-one-rust", "--puppyone-build-info"], capture=True).stdout
        )
        print("[deb] build-info:", deb_info, flush=True)
        assert deb_info["version"] == expected_version, deb_info
        assert deb_info["channel"] == "internal", deb_info
        assert deb_info["packaged"] is True, deb_info

        launch_and_verify_cli_hello(["/usr/bin/puppy-one-rust"], "deb", expected_version)

        run(["sudo", "dpkg", "-r", "puppyone-internal"])
        deb_installed = False
        assert not Path("/usr/bin/puppy-one-rust").exists()

        # 2. Extract-inspect and smoke-test .AppImage.
        extract_dir = work / "extracted"
        extract_dir.mkdir(parents=True, exist_ok=True)
        run([str(appimage_file), "--appimage-extract"], cwd=extract_dir)
        assert (extract_dir / "squashfs-root" / "usr/lib/libpdfium.so").is_file(), (
            "PDFium missing inside AppImage"
        )

        appimage_info = json.loads(
            run(
                [str(appimage_file), "--appimage-extract-and-run", "--puppyone-build-info"],
                capture=True,
            ).stdout
        )
        print("[appimage] build-info:", appimage_info, flush=True)
        assert appimage_info["version"] == expected_version, appimage_info
        assert appimage_info["channel"] == "internal", appimage_info
        assert appimage_info["packaged"] is True, appimage_info

        launch_and_verify_cli_hello(
            [str(appimage_file), "--appimage-extract-and-run"],
            "appimage",
            expected_version,
        )
        print("Linux .deb + .AppImage full smoke test PASSED.", flush=True)
    finally:
        if deb_installed:
            run(["sudo", "dpkg", "-r", "puppyone-internal"], check=False)
        shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    main()
