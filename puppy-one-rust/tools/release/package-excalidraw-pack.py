#!/usr/bin/env python3
"""Package the standalone on-demand Excalidraw Viewer Pack (`puppyone.excalidraw`)
as a deterministic `.tar.gz` archive containing `manifest.json`, `excalidraw.js`,
`excalidraw.css`, the 234 SDK fonts (`fonts/…`), and third-party license notices.

    python3 tools/release/package-excalidraw-pack.py [--out artifacts/viewer-packs]
"""
import argparse
import gzip
import hashlib
import io
import json
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
PACK_ID = 'puppyone.excalidraw'


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def add_tar_bytes(tar: tarfile.TarFile, arcname: str, data: bytes) -> None:
    info = tarfile.TarInfo(name=arcname)
    info.size = len(data)
    info.mode = 0o644
    info.mtime = 0
    info.uid = 0
    info.gid = 0
    info.uname = ''
    info.gname = ''
    tar.addfile(info, io.BytesIO(data))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--out', type=Path, default=ROOT / 'artifacts/viewer-packs')
    args = parser.parse_args()

    receipt = json.loads((ROOT / 'assets/web/excalidraw.json').read_text())
    font_manifest = json.loads((ROOT / 'assets/web/excalidraw-fonts.json').read_text())
    version = font_manifest['version']
    fonts = font_manifest['fonts']

    font_root = ROOT / 'vendor/excalidraw/fonts'
    check = subprocess.run([sys.executable, str(ROOT / 'tools/fetch-excalidraw-fonts.py'), '--check'],
                           capture_output=True, text=True)
    if check.returncode != 0:
        subprocess.run([sys.executable, str(ROOT / 'tools/fetch-excalidraw-fonts.py')], check=True)

    with tempfile.TemporaryDirectory(prefix='po-excalidraw-pack-') as tmp:
        tmp_dir = Path(tmp)
        subprocess.run(['node', str(ROOT / 'tools/import-excalidraw.mjs'), '--out-dir', str(tmp_dir)],
                       cwd=ROOT, check=True)
        js_bytes = (tmp_dir / 'excalidraw.js').read_bytes()
        css_bytes = (tmp_dir / 'excalidraw.css').read_bytes()

    if sha256_bytes(js_bytes) != receipt['outputs']['excalidraw.js']:
        raise SystemExit('Built excalidraw.js digest does not match assets/web/excalidraw.json')
    if sha256_bytes(css_bytes) != receipt['outputs']['excalidraw.css']:
        raise SystemExit('Built excalidraw.css digest does not match assets/web/excalidraw.json')

    pack_manifest = json.dumps({
        'schemaVersion': 1,
        'id': PACK_ID,
        'version': version,
        'outputs': receipt['outputs'],
        'fontCount': len(fonts),
    }, indent=2).encode('utf-8') + b'\n'

    args.out.mkdir(parents=True, exist_ok=True)
    archive_path = args.out / f'{PACK_ID}-{version}.tar.gz'
    raw_tar = io.BytesIO()
    with tarfile.open(fileobj=raw_tar, mode='w') as tar:
        add_tar_bytes(tar, 'manifest.json', pack_manifest)
        add_tar_bytes(tar, 'excalidraw.js', js_bytes)
        add_tar_bytes(tar, 'excalidraw.css', css_bytes)
        add_tar_bytes(tar, 'LICENSE', (ROOT / 'licenses/excalidraw/LICENSE').read_bytes())
        add_tar_bytes(tar, 'FONT-NOTICES.txt', (ROOT / 'licenses/excalidraw/FONT-NOTICES.txt').read_bytes())
        for rel_path in sorted(fonts.keys()):
            font_bytes = (font_root / rel_path).read_bytes()
            if sha256_bytes(font_bytes) != fonts[rel_path]:
                raise SystemExit(f'Font digest mismatch for {rel_path}')
            add_tar_bytes(tar, f'fonts/{rel_path}', font_bytes)

    compressed = gzip.compress(raw_tar.getvalue(), compresslevel=9, mtime=0)
    archive_path.write_bytes(compressed)
    meta_path = args.out / f'{PACK_ID}-{version}.sha256'
    digest = sha256_bytes(compressed)
    meta_path.write_text(f'{digest}  {archive_path.name}\n')
    print(f'Packaged {archive_path} ({len(compressed) / (1024 * 1024):.2f} MiB, sha256={digest})')


if __name__ == '__main__':
    main()
