#!/usr/bin/env python3
"""Compare outer UI only. Blank editor/agent pixels NEVER inflate the score.
Requires Pillow + numpy. --check fails until EVERY outer region is pixel-identical.
"""
import argparse
import json
from pathlib import Path
import io
import numpy as np
from PIL import Image, ImageCms


def srgb(image):
    """OS captures carry the display's ICC profile and Chromium its own;
    compare colours, not encoded bytes: convert both to sRGB first."""
    profile = image.info.get("icc_profile")
    if profile:
        return ImageCms.profileToProfile(image.convert("RGB"), ImageCms.ImageCmsProfile(io.BytesIO(profile)),
                                         ImageCms.createProfile("sRGB"), outputMode="RGB")
    return image.convert("RGB")

parser = argparse.ArgumentParser()
parser.add_argument("reference", type=Path)
parser.add_argument("native", type=Path)
parser.add_argument("--check", action="store_true")
parser.add_argument("--surface", choices=["settings", "project", "feedback", "agent"],
                    help="Use actual reference-shell component regions; requires identical viewport/DPR")
args = parser.parse_args()
a = np.asarray(srgb(Image.open(args.reference)), dtype=np.int16)
b = np.asarray(srgb(Image.open(args.native)), dtype=np.int16)
if a.shape != b.shape:
    raise SystemExit(f"Size mismatch: reference {a.shape}, native {b.shape}")
if args.surface:
    geometry = json.loads(args.reference.with_suffix(".json").read_text())
    scale = geometry["dpr"]
    if list(a.shape[:2]) != [round(v * scale) for v in reversed(geometry["viewport"])]:
        raise SystemExit("Reference viewport/DPR does not match PNG")
    selectors = {
        "settings": ["desktop-settings-dialog-header", "desktop-settings-dialog-navigation", "desktop-settings-dialog-content"],
        "project": ["desktop-project-menu"],
        "feedback": ["desktop-feedback-dialog"],
        "agent": ["desktop-terminal-launcher"],
    }[args.surface]
    regions = {}
    for selector in selectors:
        matches = [r["rect"] for r in geometry["regions"] if selector in r["selector"].split()]
        if len(matches) != 1:
            raise SystemExit(f"Expected one reference region: {selector}")
        regions[selector] = matches[0]
    scope = "actual product component fixture regions; includes unavailable-service differences, not full App acceptance"
else:
    geometry = json.loads(args.native.with_suffix(".json").read_text())
    scale = geometry["pixelsPerPoint"]
    regions = {k: geometry[k] for k in ("header", "explorer", "footer")}
    # AppKit caption buttons are not part of the canvas screenshots; exclude their slot.
    x, y, w, h = regions["header"]
    regions["header"] = [x + 80, y, w - 80, h]
    rx, ry, rw, rh = geometry["auxiliary"]
    if rw:
        regions["right-divider"] = [rx - 1, ry, 1, rh]
    scope = "synthetic source-CSS fixture; not full product parity"
report = {"scope": scope, "regions": {}}
diff_image = np.zeros_like(a, dtype=np.uint8)
identical = True
for name, (x, y, w, h) in regions.items():
    x0, y0, x1, y1 = [round(v * scale) for v in (x, y, x + w, y + h)]
    if not (0 <= x0 < x1 <= a.shape[1] and 0 <= y0 < y1 <= a.shape[0]):
        raise SystemExit(f"Invalid/out-of-bounds region: {name}")
    ar, br = a[y0:y1, x0:x1], b[y0:y1, x0:x1]
    delta = np.abs(ar - br)
    changed = np.max(delta, axis=2) > 0
    beyond_8 = np.max(delta, axis=2) > 8
    # Foreground union excludes broad quiet fills; reports text/icon raster differences separately.
    bg_a = np.median(ar.reshape(-1, 3), axis=0)
    bg_b = np.median(br.reshape(-1, 3), axis=0)
    ink = (np.max(np.abs(ar - bg_a), axis=2) > 45) | (np.max(np.abs(br - bg_b), axis=2) > 45)
    report["regions"][name] = {
        "logicalRect": [x, y, w, h],
        "exactMismatchPercent": round(float(changed.mean()) * 100, 3),
        "differenceOver8Percent": round(float(beyond_8.mean()) * 100, 3),
        "meanAbsoluteChannelError": round(float(delta.mean()), 3),
        "foregroundDifferenceOver8Percent": round(float(beyond_8[ink].mean()) * 100, 3) if ink.any() else None,
    }
    identical &= not changed.any()
    diff_image[y0:y1, x0:x1] = np.minimum(delta * 4, 255).astype(np.uint8)
report["pixelIdentical"] = bool(identical)
output = args.native.with_suffix(".comparison.json")
output.write_text(json.dumps(report, indent=2) + "\n")
Image.fromarray(diff_image).save(args.native.with_suffix(".diff.png"))
print(json.dumps(report, indent=2))
if args.check and not identical:
    raise SystemExit(1)
