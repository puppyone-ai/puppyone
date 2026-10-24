#!/usr/bin/env python3
"""List the regions where a native capture differs from its reference:
connected clusters of >tolerance pixels on a coarse grid, largest first,
in CSS px. python3 tools/diff-hotspots.py REF.png NATIVE.png [--cell 8] [--top 20]"""
import argparse
import numpy as np
from PIL import Image
from collections import deque

p = argparse.ArgumentParser()
p.add_argument("reference"); p.add_argument("native")
p.add_argument("--cell", type=int, default=8)
p.add_argument("--top", type=int, default=20)
p.add_argument("--tolerance", type=int, default=8)
p.add_argument("--scale", type=float, default=2)
a = p.parse_args()
r = np.asarray(Image.open(a.reference).convert("RGB"), dtype=np.int16)
n = np.asarray(Image.open(a.native).convert("RGB"), dtype=np.int16)
changed = np.abs(r - n).max(axis=2) > a.tolerance
c = a.cell
h, w = changed.shape[0] // c, changed.shape[1] // c
grid = changed[:h * c, :w * c].reshape(h, c, w, c).sum(axis=(1, 3))
hot = grid > 0
seen = np.zeros_like(hot)
clusters = []
for y in range(h):
    for x in range(w):
        if hot[y, x] and not seen[y, x]:
            q = deque([(y, x)]); seen[y, x] = True; cells = []
            while q:
                cy, cx = q.popleft(); cells.append((cy, cx))
                for dy in (-1, 0, 1):
                    for dx in (-1, 0, 1):
                        ny, nx = cy + dy, cx + dx
                        if 0 <= ny < h and 0 <= nx < w and hot[ny, nx] and not seen[ny, nx]:
                            seen[ny, nx] = True; q.append((ny, nx))
            ys = [p[0] for p in cells]; xs = [p[1] for p in cells]
            count = sum(grid[p] for p in cells)
            clusters.append((count, min(xs) * c / a.scale, min(ys) * c / a.scale, (max(xs) + 1) * c / a.scale, (max(ys) + 1) * c / a.scale))
clusters.sort(reverse=True)
total = changed.sum()
print(f"changed px {total}")
for count, x0, y0, x1, y1 in clusters[:a.top]:
    print(f"{count:7d}  x {x0:6.0f}-{x1:6.0f}  y {y0:6.0f}-{y1:6.0f}")
