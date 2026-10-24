#!/usr/bin/env python3
"""Compare the native editor's geometry dump with the product probe.

  python3 tools/compare-native-geometry.py native.json artifacts/probe/sample-dark.json

Both files give per-character rects relative to the editor viewport
(`PUPPYONE_EDITOR_GEOMETRY` from a `dev-capture` build; tools/probe-editor.mjs
for Chromium). Prints block tops and the per-line x/y deltas of glyph boxes.
"""
import json
import sys

native = json.load(open(sys.argv[1]))
ref = json.load(open(sys.argv[2]))
limit = float(sys.argv[3]) if len(sys.argv) > 3 else 0.6

# The probe counts UTF-16 code units (JavaScript); the dump counts UTF-8 bytes.
doc = open(ref['spec']['file'], encoding='utf-8').read()
utf16 = {}
units = 0
for i, ch in enumerate(doc):
    utf16[len(doc[:i].encode('utf-8'))] = units
    units += 2 if ord(ch) > 0xFFFF else 1
for c in native['chars']:
    c['at'] = utf16.get(c['at'], -1)
ref_chars = {c['at']: c for c in ref['chars']}
worst = 0.0
rows = {}
for c in native['chars']:
    r = ref_chars.get(c['at'])
    if not r or c['ch'] != r['ch']:
        continue
    dx = c['rect'][0] - r['rect'][0]
    dy = c['rect'][1] - r['rect'][1]
    key = round(r['rect'][1], 1)
    rows.setdefault(key, []).append((c['at'], c['ch'], dx, dy, c['rect'][2] - r['rect'][2]))
    worst = max(worst, abs(dx), abs(dy))
matched = sum(len(v) for v in rows.values())
print(f"matched {matched}/{len(ref['chars'])} reference chars; worst |d| {worst:.2f}px")
for y in sorted(rows):
    items = rows[y]
    dxs = [d[2] for d in items]
    dys = [d[3] for d in items]
    text = ''.join(d[1] for d in items)[:48]
    flag = '' if max(map(abs, dxs + dys)) <= limit else '  <--'
    print(f"y={y:7.1f} n={len(items):3d} dx[{min(dxs):+.2f},{max(dxs):+.2f}] dy[{min(dys):+.2f},{max(dys):+.2f}] {text!r}{flag}")
