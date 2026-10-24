#!/usr/bin/env python3
"""Static Geist UI faces from the product's variable font (development only).

The product draws UI text with the Geist variable font at CSS weights 400, 500
(medium labels, launcher heading, tool names), 600 and 700. GPUI selects a face
by family and weight, so each weight becomes a static face of the single
"Geist" family with its own subfamily and OS/2 weight class.

  python3 tools/import-font.py [--check]     (requires fontTools[woff])
"""
import hashlib
import io
import json
import sys
from pathlib import Path

from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

root = Path(__file__).resolve().parents[1]
config = json.loads((root / "product-source.json").read_text())
product = (root / config["checkout"]).resolve()
source = product / "public/fonts/geist/Geist-Variable.woff2"
FACES = {400: "Regular", 500: "Medium", 600: "SemiBold", 700: "Bold"}


def face(weight: int, style: str) -> bytes:
    font = instantiateVariableFont(TTFont(source), {"wght": weight}, inplace=True)
    font.flavor = None
    name = font["name"]
    for record in list(name.names):
        if record.nameID in (1, 2, 3, 4, 6, 16, 17, 21, 22, 25):
            name.removeNames(nameID=record.nameID)
    full = "Geist" if style == "Regular" else f"Geist {style}"
    ps = f"Geist-{style}"
    for name_id, value in [(1, "Geist"), (2, style), (3, f"{ps};puppyone-ui"), (4, full), (6, ps), (16, "Geist"), (17, style)]:
        name.setName(value, name_id, 3, 1, 0x409)
        name.setName(value, name_id, 1, 0, 0)
    os2 = font["OS/2"]
    os2.usWeightClass = weight
    selection = os2.fsSelection & ~0b1100001
    selection |= 0b100000 if weight == 700 else 0
    if weight == 400:
        selection |= 0b1000000
    os2.fsSelection = selection
    font["head"].macStyle = 0b1 if weight == 700 else 0
    if "STAT" in font:
        del font["STAT"]
    buffer = io.BytesIO()
    font.save(buffer)
    return buffer.getvalue()


check = "--check" in sys.argv
stale = []
for weight, style in FACES.items():
    path = root / f"assets/Geist-{style}.ttf"
    data = face(weight, style)
    if check:
        if not path.exists() or hashlib.sha256(path.read_bytes()).digest() != hashlib.sha256(data).digest():
            stale.append(path.name)
    else:
        path.write_bytes(data)
if stale:
    sys.exit(f"Stale Geist UI faces: {', '.join(stale)}; run tools/import-font.py")
print("Geist UI faces:", ", ".join(f"{w} {s}" for w, s in FACES.items()))
