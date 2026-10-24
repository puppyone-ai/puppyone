#!/usr/bin/env python3
"""Real native-window / Wry / CodeMirror / disk roundtrip in a disposable folder.
Requires a desktop session; never points the app at a user's workspace.
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import sys
import time

root = Path(__file__).resolve().parents[1]
cargo = shutil.which("cargo") or str(Path.home() / ".cargo/bin/cargo")
subprocess.run([cargo, "build", "--locked", "--features", "webview-smoke"], cwd=root, check=True)
artifacts = root / "artifacts/editor-smoke"
artifacts.mkdir(parents=True, exist_ok=True)
capture = '--capture' in sys.argv
if capture:
    if sys.platform != 'darwin':
        raise SystemExit('OS composite capture currently requires macOS')
    subprocess.run(['swiftc', str(root / 'tools/window-id.swift'), '-o', str(artifacts / 'window-id')], check=True)
with tempfile.TemporaryDirectory(prefix="puppyone-rust-smoke-") as folder:
    workspace = Path(folder)
    (workspace / ".puppyone-smoke-marker").write_text("disposable-native-editor-test\n")
    (workspace / "note.md").write_bytes(b"\xef\xbb\xbf# Rich Markdown\r\n\r\n**Bold** and *italic*.\r\n\r\n- [ ] A task\r\n\r\n| Name | Value |\r\n| --- | --- |\r\n| PuppyOne | Rust |\r\n")
    (workspace / "second.txt").write_bytes(b"second\n")
    (workspace / "table.csv").write_bytes(b"id,name\n1,original\n")
    environment = {k: v for k, v in os.environ.items() if not k.startswith("PUPPYONE_")}
    environment["PUPPYONE_SMOKE_DIR"] = str(workspace)
    environment["PUPPYONE_RUST_DATA_DIR"] = str(workspace / "profile")
    if capture:
        environment["PUPPYONE_SMOKE_CAPTURE"] = '1'
    binary = root / "target/debug" / ("puppy-one-rust.exe" if os.name == "nt" else "puppy-one-rust")
    with (artifacts / "process.log").open("w") as log:
        process = subprocess.Popen([str(binary), "--workspace", str(workspace)], cwd=root, env=environment, stdout=log, stderr=subprocess.STDOUT)
        try:
            deadline = time.monotonic() + 55
            while capture and process.poll() is None:
                request = workspace / 'capture-request'
                if request.exists():
                    name = request.read_text()
                    ack = workspace / f'captured-{name}'
                    if name and not ack.exists():
                        assert name in ['settings-over-editor','project-over-editor','right-resize-editor','confirm-over-editor']
                        time.sleep(0.25)  # capture only after the GPU frame commits
                        window = subprocess.check_output([str(artifacts / 'window-id'), str(process.pid)], text=True).strip()
                        subprocess.run(['screencapture', '-x', '-o', '-l', window, str(artifacts / f'{name}.png')], check=True)
                        if name == 'right-resize-editor':
                            from PIL import Image
                            pixels=Image.open(artifacts / f'{name}.png').convert('RGB')
                            scale=pixels.width/1280
                            region=pixels.crop(tuple(round(v*scale) for v in (270,70,850,300)))
                            ink=sum(1 for rgb in region.getdata() if min(rgb)>150)
                            assert ink>100, 'Visible editor text is missing in OS capture (DOM success is insufficient)'
                        ack.touch()
                if time.monotonic() > deadline:
                    raise subprocess.TimeoutExpired(process.args, 55)
                time.sleep(0.02)
            code = process.wait(timeout=55)
        except subprocess.TimeoutExpired:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
            raise SystemExit(f"Native smoke timed out; inspect {artifacts / 'process.log'}")
        finally:
            # Only this runner's disposable child, never a user's open window.
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
    if code:
        raise SystemExit(f"Native smoke failed ({code}); inspect {artifacts / 'process.log'}")
    receipt = json.loads((workspace / "result.json").read_text())
    assert receipt["passed"]
    (artifacts / "result.json").write_text(json.dumps(receipt, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps(receipt, indent=2, ensure_ascii=False))
