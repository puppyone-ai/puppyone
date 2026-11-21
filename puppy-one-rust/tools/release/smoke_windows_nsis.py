#!/usr/bin/env python3
"""End-to-end Windows NSIS packaging, Authenticode signing, silent install,
CLI Named Pipe handshake, local-feed self-update, and clean uninstall smoke test.

Intended for Windows CI (`windows-2025`):
  1. Generates a temporary self-signed Authenticode certificate (`CN=PuppyOne`),
     trusts it in `Cert:\\CurrentUser\\Root`, and cleans it up in `finally`.
  2. Packages v1 (`0.4.90`) and v2 (`0.4.91`) signed NSIS installers via
     `tools/release/package.py --target windows --channel stable`.
  3. Silently installs v1 (`/S`), checks installed files, `pdfium.dll`, HKCU
     URL scheme registration, and `--puppyone-build-info`.
  4. Launches the installed `puppy-one-rust.exe --puppyone-cli-launch` with an
     isolated `PUPPYONE_RUST_DATA_DIR`, connects to its Windows Named Pipe, and
     verifies the `hello` protocol v1 JSON response and clean process exit.
  5. Serves v2 (`stable-win.yml` + signed NSIS `.exe`) over local HTTP and runs
     the Rust `po-platform` Windows updater smoke test (`updates::check` ->
     `updates::download` -> `Backend::prepare` with `WinVerifyTrust` & publisher
     check -> PowerShell out-of-process `/S` update helper), verifying the
     installed binary upgraded cleanly to `0.4.91`.
  6. Runs `Uninstall.exe /S` and verifies installation directory and HKCU
     registry cleanup.
"""
import ctypes
import functools
import hashlib
import http.server
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import winreg
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]


def run(cmd, *, env=None, check=True, capture=False):
    print(f"+ {' '.join(str(c) for c in cmd)}", flush=True)
    return subprocess.run(
        [str(c) for c in cmd],
        cwd=str(ROOT),
        env=env,
        check=check,
        text=True,
        capture_output=capture,
    )


def create_ci_signing_cert(pfx_path: Path, password: str) -> str:
    script = f"""
$ErrorActionPreference = 'Stop'
$cert = New-SelfSignedCertificate -Type CodeSigningCert -Subject 'CN=PuppyOne' -CertStoreLocation 'Cert:\\CurrentUser\\My' -NotAfter (Get-Date).AddDays(2)
$pwd = ConvertTo-SecureString -String '{password}' -Force -AsPlainText
Export-PfxCertificate -Cert $cert -FilePath '{pfx_path}' -Password $pwd | Out-Null
$cer = Join-Path (Split-Path '{pfx_path}') 'ci-signing.cer'
Export-Certificate -Cert $cert -FilePath $cer | Out-Null
Import-Certificate -FilePath $cer -CertStoreLocation 'Cert:\\CurrentUser\\Root' | Out-Null
Write-Output $cert.Thumbprint
"""
    res = run(
        ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script],
        capture=True,
    )
    thumbprint = res.stdout.strip().splitlines()[-1].strip()
    if not thumbprint:
        raise RuntimeError(f"Failed to create CI signing certificate: {res.stderr}")
    print(f"Created and trusted temporary CI Authenticode cert: {thumbprint}", flush=True)
    return thumbprint


def remove_ci_signing_cert(thumbprint: str) -> None:
    if not thumbprint:
        return
    script = f"""
Get-ChildItem 'Cert:\\CurrentUser\\My\\{thumbprint}' -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
Get-ChildItem 'Cert:\\CurrentUser\\Root\\{thumbprint}' -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
"""
    run(
        ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script],
        check=False,
    )


def named_pipe_hello(data_dir: Path, timeout_s: float = 20.0) -> dict:
    token = hashlib.sha256(str(data_dir).encode("utf-8")).hexdigest()[:24]
    pipe_name = rf"\\.\pipe\puppyone-cli-{token}"
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)

    GENERIC_READ = 0x80000000
    GENERIC_WRITE = 0x40000000
    OPEN_EXISTING = 3
    INVALID_HANDLE_VALUE = ctypes.c_void_p(-1).value

    kernel32.CreateFileW.argtypes = [
        ctypes.c_wchar_p,
        ctypes.c_uint32,
        ctypes.c_uint32,
        ctypes.c_void_p,
        ctypes.c_uint32,
        ctypes.c_uint32,
        ctypes.c_void_p,
    ]
    kernel32.CreateFileW.restype = ctypes.c_void_p
    kernel32.WaitNamedPipeW.argtypes = [ctypes.c_wchar_p, ctypes.c_uint32]
    kernel32.WaitNamedPipeW.restype = ctypes.c_int
    kernel32.WriteFile.argtypes = [
        ctypes.c_void_p,
        ctypes.c_void_p,
        ctypes.c_uint32,
        ctypes.POINTER(ctypes.c_uint32),
        ctypes.c_void_p,
    ]
    kernel32.WriteFile.restype = ctypes.c_int
    kernel32.ReadFile.argtypes = [
        ctypes.c_void_p,
        ctypes.c_void_p,
        ctypes.c_uint32,
        ctypes.POINTER(ctypes.c_uint32),
        ctypes.c_void_p,
    ]
    kernel32.ReadFile.restype = ctypes.c_int
    kernel32.CloseHandle.argtypes = [ctypes.c_void_p]
    kernel32.CloseHandle.restype = ctypes.c_int

    deadline = time.monotonic() + timeout_s
    handle = INVALID_HANDLE_VALUE
    while time.monotonic() < deadline:
        kernel32.WaitNamedPipeW(pipe_name, 250)
        h = kernel32.CreateFileW(
            pipe_name,
            GENERIC_READ | GENERIC_WRITE,
            0,
            None,
            OPEN_EXISTING,
            0,
            None,
        )
        if h != INVALID_HANDLE_VALUE:
            handle = h
            break
        time.sleep(0.1)

    if handle == INVALID_HANDLE_VALUE:
        raise TimeoutError(f"Timed out connecting to Windows CLI Named Pipe {pipe_name}")

    try:
        payload = b'{"protocol":1,"type":"hello"}\n'
        written = ctypes.c_uint32(0)
        ok = kernel32.WriteFile(handle, payload, len(payload), ctypes.byref(written), None)
        if not ok or written.value != len(payload):
            raise OSError(f"WriteFile failed (err={ctypes.get_last_error()})")

        chunks = bytearray()
        buf = ctypes.create_string_buffer(4096)
        while b"\n" not in chunks:
            read_n = ctypes.c_uint32(0)
            ok = kernel32.ReadFile(handle, buf, len(buf), ctypes.byref(read_n), None)
            if not ok or read_n.value == 0:
                break
            chunks.extend(buf.raw[: read_n.value])
        line = chunks.split(b"\n", 1)[0].decode("utf-8").strip()
        return json.loads(line)
    finally:
        kernel32.CloseHandle(handle)


def check_hkcu_key_exists(subkey: str) -> bool:
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, subkey):
            return True
    except FileNotFoundError:
        return False


def wait_for_file(path: Path, *, should_exist: bool, timeout_s: float = 45.0) -> None:
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        if path.exists() == should_exist:
            return
        time.sleep(0.25)
    state = "appear" if should_exist else "disappear"
    raise TimeoutError(f"Timed out waiting for {path} to {state}")


def main() -> None:
    if sys.platform != "win32":
        raise SystemExit("smoke_windows_nsis.py must run on Windows")

    work = Path(tempfile.mkdtemp(prefix="puppyone-nsis-smoke-"))
    pfx_path = work / "ci-signing.pfx"
    pfx_password = "puppyone-ci-smoke-password"
    thumbprint = ""
    install_dir = Path(os.environ["LOCALAPPDATA"]) / "Programs" / "PuppyOne"
    uninstaller = install_dir / "Uninstall.exe"

    try:
        thumbprint = create_ci_signing_cert(pfx_path, pfx_password)

        pkg_env = {
            **os.environ,
            "VITE_DESKTOP_CLOUD_API_URL": "https://api.puppyone.ai/api/v1",
            "VITE_DESKTOP_CLOUD_WEB_URL": "https://puppyone.ai",
            "WIN_CSC_LINK": str(pfx_path),
            "WIN_CSC_KEY_PASSWORD": pfx_password,
            "WIN_TIMESTAMP_URL": "none",
        }

        v1_out = work / "v1"
        v2_out = work / "v2"

        # 1. Build and sign v1 (0.4.90) NSIS installer.
        run(
            [
                sys.executable,
                "tools/release/package.py",
                "--target",
                "windows",
                "--channel",
                "stable",
                "--build-number",
                "100",
                "--base-version",
                "0.4.90",
                "--update-feed-url",
                "https://updates.puppyone.ai/desktop/stable/win/latest",
                "--out",
                str(v1_out),
            ],
            env=pkg_env,
        )
        v1_installer = next((v1_out / "stable").glob("puppyone-0.4.90-win-*-setup.exe"))
        assert (v1_out / "stable" / "stable-win.yml").is_file(), "missing v1 stable-win.yml"

        # 2. Build and sign v2 (0.4.91) NSIS installer (incremental release rebuild).
        run(
            [
                sys.executable,
                "tools/release/package.py",
                "--target",
                "windows",
                "--channel",
                "stable",
                "--build-number",
                "101",
                "--base-version",
                "0.4.91",
                "--update-feed-url",
                "https://updates.puppyone.ai/desktop/stable/win/latest",
                "--out",
                str(v2_out),
            ],
            env=pkg_env,
        )
        v2_dir = v2_out / "stable"
        assert next(v2_dir.glob("puppyone-0.4.91-win-*-setup.exe")).is_file()
        assert (v2_dir / "stable-win.yml").is_file(), "missing v2 stable-win.yml"

        # 3. Silent NSIS install of v1.
        run([v1_installer, "/S"])
        installed_exe = install_dir / "puppy-one-rust.exe"
        wait_for_file(installed_exe, should_exist=True)
        assert (install_dir / "pdfium.dll").is_file(), "pdfium.dll missing from NSIS install"
        assert uninstaller.is_file(), "Uninstall.exe missing from NSIS install"
        assert check_hkcu_key_exists(r"Software\Classes\puppyone"), "URL scheme key missing"
        assert check_hkcu_key_exists(
            r"Software\Microsoft\Windows\CurrentVersion\Uninstall\ai.puppyone.desktop"
        ), "Uninstall registry key missing"

        # 4. Verify --puppyone-build-info on installed v1 binary.
        info_v1 = json.loads(
            run([installed_exe, "--puppyone-build-info"], capture=True).stdout
        )
        print("Installed v1 build-info:", info_v1, flush=True)
        assert info_v1["version"] == "0.4.90", info_v1
        assert info_v1["channel"] == "stable", info_v1
        assert info_v1["packaged"] is True, info_v1

        # 5. Launch installed app and perform CLI Named Pipe hello handshake.
        cli_data_dir = work / "cli-data"
        cli_data_dir.mkdir(parents=True, exist_ok=True)
        proc = subprocess.Popen(
            [str(installed_exe), "--puppyone-cli-launch"],
            env={**os.environ, "PUPPYONE_RUST_DATA_DIR": str(cli_data_dir)},
        )
        try:
            hello = named_pipe_hello(cli_data_dir)
            print("Windows CLI Named Pipe hello reply:", hello, flush=True)
            assert hello["ok"] is True, hello
            assert hello["protocol"] == 1, hello
            assert hello["app"]["version"] == "0.4.90", hello
            assert hello["app"]["channel"] == "stable", hello
            proc.wait(timeout=20)
            assert proc.returncode == 0, f"app exited with {proc.returncode}"
        finally:
            if proc.poll() is None:
                proc.terminate()
                proc.wait(timeout=10)

        # 6. Serve v2 feed over local HTTP and exercise real Rust updater -> NSIS /S upgrade.
        handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(v2_dir))
        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
        port = server.server_address[1]
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            smoke_env = {
                **os.environ,
                "PUPPYONE_SMOKE_FEED_URL": f"http://127.0.0.1:{port}",
                "PUPPYONE_SMOKE_INSTALLED_EXE": str(installed_exe),
                "PUPPYONE_SMOKE_CURRENT_VERSION": "0.4.90",
                "PUPPYONE_SMOKE_EXPECTED_VERSION": "0.4.91",
                "PUPPYONE_SMOKE_EXPECTED_PUBLISHERS": "PuppyOne",
            }
            run(
                [
                    "cargo",
                    "test",
                    "--locked",
                    "-p",
                    "po-platform",
                    "--lib",
                    "windows_local_feed_update_smoke_installs_signed_nsis_installer",
                    "--",
                    "--ignored",
                    "--nocapture",
                ],
                env=smoke_env,
            )
        finally:
            server.shutdown()
            server.server_close()

        # Verify installed executable upgraded to 0.4.91!
        info_v2 = json.loads(
            run([installed_exe, "--puppyone-build-info"], capture=True).stdout
        )
        print("Upgraded v2 build-info:", info_v2, flush=True)
        assert info_v2["version"] == "0.4.91", info_v2
        assert info_v2["packaged"] is True, info_v2

        # 7. Silent NSIS uninstall and cleanup verification.
        run([uninstaller, "/S"])
        wait_for_file(installed_exe, should_exist=False)
        wait_for_file(install_dir, should_exist=False)
        assert not check_hkcu_key_exists(r"Software\Classes\puppyone"), "URL scheme left behind"
        assert not check_hkcu_key_exists(
            r"Software\Microsoft\Windows\CurrentVersion\Uninstall\ai.puppyone.desktop"
        ), "Uninstall registry key left behind"
        print("Windows NSIS full lifecycle smoke test PASSED.", flush=True)
    finally:
        if uninstaller.is_file():
            run([uninstaller, "/S"], check=False)
        remove_ci_signing_cert(thumbprint)
        shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    main()
