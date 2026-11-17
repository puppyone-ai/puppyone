#!/usr/bin/env python3
"""Compare text/ink line bands of a reference and a native capture in one
column range: prints each band (top..bottom, left..right in CSS px) side by
side, so vertical rhythm and horizontal starts can be aligned row by row.

  python3 tools/ink-bands.py REF.png NATIVE.png X0 X1 [Y0 Y1] [--threshold 28]
"""
import argparse
import numpy as np
from PIL import Image

p = argparse.ArgumentParser()
p.add_argument("reference")
p.add_argument("native")
p.add_argument("x0", type=float)
p.add_argument("x1", type=float)
p.add_argument("y0", type=float, nargs="?", default=0)
p.add_argument("y1", type=float, nargs="?", default=1e9)
p.add_argument("--threshold", type=int, default=28)
p.add_argument("--scale", type=float, default=2)
a = p.parse_args()

def bands(path):
    img = np.asarray(Image.open(path).convert("RGB"), dtype=np.int16)
    s = a.scale
    y0, y1 = int(a.y0 * s), int(min(a.y1 * s, img.shape[0]))
    x0, x1 = int(a.x0 * s), int(a.x1 * s)
    region = img[y0:y1, x0:x1]
    bg = np.median(region.reshape(-1, 3), axis=0)
    ink = np.abs(region - bg).max(axis=2) > a.threshold
    rows = ink.any(axis=1)
    out, start = [], None
    for i, v in enumerate(list(rows) + [False]):
        if v and start is None:
            start = i
        elif not v and start is not None:
            cols = np.nonzero(ink[start:i].any(axis=0))[0]
            out.append(((y0 + start) / s, (y0 + i) / s, (x0 + cols.min()) / s, (x0 + cols.max() + 1) / s))
            start = None
    return out

ra, rb = bands(a.reference), bands(a.native)
fmt = lambda b: f"{b[0]:7.1f}-{b[1]:7.1f} x {b[2]:6.1f}-{b[3]:6.1f}" if b else " " * 33
print(f"{'reference':33} | {'native':33} | dy   dx")
for i in range(max(len(ra), len(rb))):
    x = ra[i] if i < len(ra) else None
    y = rb[i] if i < len(rb) else None
    d = f"{y[0]-x[0]:+5.1f} {y[2]-x[2]:+5.1f}" if x and y else ""
    print(f"{fmt(x)} | {fmt(y)} | {d}")
