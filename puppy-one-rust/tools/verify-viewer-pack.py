#!/usr/bin/env python3
"""Require pinned pack installation and, on macOS, its real WebKit runtime."""
import hashlib
import json
from pathlib import Path
import platform
import subprocess
import sys
from source_identity import source_hashes
from test_runner import ROOT, run_gate


def main():
    out = ROOT / 'artifacts/viewer-pack-verification'
    out.mkdir(parents=True, exist_ok=True)
    (out / 'result.json').unlink(missing_ok=True)
    before = source_hashes()
    result = subprocess.run([sys.executable, 'tools/release/package-excalidraw-pack.py'],
                            cwd=ROOT, capture_output=True, text=True, timeout=240)
    (out / 'package.log').write_text(result.stdout + result.stderr)
    if result.returncode:
        raise RuntimeError(f'Pinned pack build failed; see {out / "package.log"}')
    if source_hashes() != before:
        raise RuntimeError('Pack packaging changed verified source files')
    spec = json.loads((ROOT / 'assets/web/excalidraw-fonts.json').read_text())
    archive = ROOT / f'artifacts/viewer-packs/puppyone.excalidraw-{spec["version"]}.tar.gz'
    required = [{
        'package': 'po-platform',
        'test': 'platform::viewer_packs::tests::the_actual_pinned_pack_installs_all_sdk_fonts_without_network_fallback',
    }]
    if platform.system() == 'Darwin':
        required.append({
            'package': 'po-editor', 'target': 'webview_whiteboard_native',
            'features': ['dev-capture'], 'timeout': 120,
            'test': 'real_webkit_whiteboard_draws_and_preserves_document_boundaries',
        })
    report = run_gate('viewer-pack-verification', required, metadata={
        'archiveSha256': hashlib.sha256(archive.read_bytes()).hexdigest(),
        'nativeWebKitRequired': platform.system() == 'Darwin',
        'fontCount': len(spec['fonts']),
        'baseCommit': subprocess.check_output(
            ['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
    })
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    sys.exit(main())
