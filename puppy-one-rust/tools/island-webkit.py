#!/usr/bin/env python3
"""Render the built content island in WebKit (offscreen WKWebView).

Assembles the page exactly like src/web_editor.rs (literal substitution of the
bundled CSS/JS), replays host messages for one fixture document and writes a
2x PNG + element geometry. Use with tools/reference-editor.mjs output to
compare WebKit (native app) against Chromium (product) without rebuilding Rust.

  python3 tools/island-webkit.py fixtures/editor/sample.md out.png [--light] [--menu] [--source]
"""
import argparse
import json
import os
from pathlib import Path
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
parser.add_argument('file', type=Path)
parser.add_argument('out', type=Path)
parser.add_argument('--light', action='store_true')
parser.add_argument('--menu', action='store_true', help='reveal the pane handle and open the pane menu')
parser.add_argument('--source', action='store_true', help='switch the pane to source mode')
parser.add_argument('--locale', default='en')
parser.add_argument('--hidden', action='store_true', help='occluded window: document.hidden, no requestAnimationFrame')
parser.add_argument('--size', default='1059x760')
parser.add_argument('--inject-css', default='', help='extra CSS appended for experiments')
parser.add_argument('--probe', default='', help='JS expression stored as window.__probe after settling')
parser.add_argument('--script', default='', help='async JS statements run after settling (may await wait(ms))')
args = parser.parse_args()

binary = root / 'target/island-webkit/island-webkit'
source = root / 'tools/island-webkit.swift'
if not binary.exists() or binary.stat().st_mtime < source.stat().st_mtime:
    binary.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(['swiftc', '-O', str(source), '-o', str(binary)], check=True)

page = (root / 'editor/src/index.html').read_text()
page = page.replace('__NONCE__', 'island-webkit').replace('__STYLE_BUNDLE__', (root / 'editor/bundle/editor.css').read_text())
page = page.replace('__SMOKE__', 'true').replace('__BUNDLE__', (root / 'editor/bundle/editor.js').read_text().replace('</script', '<\\/script'))
messages = [
    {'kind': 'theme', 'dark': not args.light, 'scale': 0},
    {'kind': 'locale', 'locale': args.locale},
    {'kind': 'open', 'id': 'doc-1', 'name': args.file.name, 'text': args.file.read_text(), 'revision': 0},
]
script = ''
if args.inject_css:
    script += f"const st=document.createElement('style');st.textContent={json.dumps(args.inject_css)};document.head.append(st);await wait(600);"
if args.source:
    script += "window.puppyEditor.receive({kind:'presentation',livePreview:false});await wait(800);"
if args.menu:
    script += ("const pane=document.querySelector('.desktop-editor-pane');"
               "pane.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:innerWidth/2,clientY:12}));"
               "document.querySelector('.desktop-editor-pane-handle')?.click();await wait(500);document.activeElement?.blur?.();")
if args.script:
    script += args.script
if args.probe:
    script += f'window.__probe=({args.probe});'
width, height = args.size.split('x')
with tempfile.TemporaryDirectory(prefix='island-webkit-') as folder:
    folder = Path(folder)
    (folder / 'page.html').write_text(page)
    (folder / 'messages.json').write_text(json.dumps(messages))
    (folder / 'script.js').write_text(script)
    out_json = args.out.with_suffix('.json')
    env = dict(os.environ, **({'ISLAND_WEBKIT_HIDDEN': '1'} if args.hidden else {}))
    subprocess.run([str(binary), str(folder / 'page.html'), str(folder / 'messages.json'), str(args.out), str(out_json),
                    width, height, str(folder / 'script.js')], check=True, timeout=60, env=env)
