#!/usr/bin/env python3
"""Agent Markdown inline-code face (development only; requires fontTools[woff]).

The product draws inline code in Agent answers as Geist Mono 500 at
`--agent-code-font-size` (13px) inside 14px text, padded `0.12em 0.34em` with a
1px border. A GPUI text run keeps the paragraph's size, so this face rescales
the em to 14/13 (glyphs render at 13px when the run is 14px) and adds U+E000,
an empty glyph whose advance is the chip's horizontal padding + border
(0.34 × 13 + 1 = 5.42px at 14px). The native renderer brackets each code span
with U+E000 and paints the chip behind it.

  python3 tools/import-agent-code-font.py [--check]
"""
import hashlib
import io
import json
import sys
from pathlib import Path

from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

root = Path(__file__).resolve().parents[1]
product = (root / json.loads((root / "product-source.json").read_text())["checkout"]).resolve()
out = root / "assets/fonts/agent-inline-code.ttf"
FAMILY = "PuppyOne Agent Inline Code"
TEXT, CODE = 14.0, 13.0
PAD = 0.34 * CODE + 1.0


def build() -> bytes:
    font = instantiateVariableFont(TTFont(product / "public/fonts/geist/GeistMono-Variable.woff2"), {"wght": 500}, inplace=True)
    font.flavor = None
    upem = round(font["head"].unitsPerEm * TEXT / CODE)
    font["head"].unitsPerEm = upem
    # The spacer glyph: no outline, advance = padding + border at the text size.
    name = "uniE000"
    pen = TTGlyphPen(None)
    font["glyf"][name] = pen.glyph()
    font["hmtx"][name] = (round(PAD / TEXT * upem), 0)
    order = font.getGlyphOrder()
    if name not in order:
        font.setGlyphOrder(order + [name])
    font["maxp"].numGlyphs = len(font.getGlyphOrder())
    for table in font["cmap"].tables:
        if table.isUnicode():
            table.cmap[0xE000] = name
    names = font["name"]
    for record in list(names.names):
        if record.nameID in (1, 2, 3, 4, 6, 16, 17, 21, 22, 25):
            names.removeNames(nameID=record.nameID)
    ps = FAMILY.replace(" ", "")
    for name_id, value in [(1, FAMILY), (2, "Regular"), (3, f"{ps};puppyone-agent"), (4, FAMILY), (6, ps), (16, FAMILY), (17, "Regular")]:
        names.setName(value, name_id, 3, 1, 0x409)
        names.setName(value, name_id, 1, 0, 0)
    font["OS/2"].usWeightClass = 400
    if "STAT" in font:
        del font["STAT"]
    buffer = io.BytesIO()
    font.save(buffer)
    return buffer.getvalue()


data = build()
if "--check" in sys.argv:
    if not out.exists() or hashlib.sha256(out.read_bytes()).digest() != hashlib.sha256(data).digest():
        sys.exit("Stale agent inline-code face; run tools/import-agent-code-font.py")
    print("Agent inline-code face verified")
else:
    out.write_bytes(data)
    print(f"{out.relative_to(root)}: {FAMILY}, spacer {PAD:.2f}px")
