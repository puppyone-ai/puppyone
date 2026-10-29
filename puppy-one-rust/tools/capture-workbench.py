#!/usr/bin/env python3
"""Capture the native right-sidebar lab and compare it with the product reference.

  python3 tools/capture-workbench.py                 # build, capture, compare all cases
  python3 tools/capture-workbench.py chat-empty-dark # only the given cases
  python3 tools/capture-workbench.py --no-build --compare-only

References come from tools/reference-workbench.mjs (real product components).
Output: artifacts/workbench-native/<case>.png, <case>.diff.png and report.json.
A pixel counts as different when any channel differs by more than --tolerance.
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
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

root = Path(__file__).resolve().parents[1]
# suite → (scenario file, native lab case prefix)
SUITES = {"workbench": ("tools/workbench-scenarios.json", ""),
          "settings": ("tools/settings-scenarios.json", "settings-"),
          "cloud": ("tools/cloud-scenarios.json", "cloud-"),
          "editor": ("tools/editor-scenarios.json", "editor-"),
          "shell": ("tools/shell-scenarios.json", "shell-")}

parser = argparse.ArgumentParser()
parser.add_argument("only", nargs="*")
parser.add_argument("--suite", choices=sorted(SUITES), default="workbench")
parser.add_argument("--no-build", action="store_true")
parser.add_argument("--compare-only", action="store_true")
parser.add_argument("--tolerance", type=int, default=8)
args = parser.parse_args()
scenario_file, lab_prefix = SUITES[args.suite]
scenarios = json.loads((root / scenario_file).read_text())["scenarios"]
cases = [dict(s, mode=m, id=f"{s['scenario']}-{m}") for s in scenarios for m in ("dark", "light")]
reference_dir = root / f"artifacts/{args.suite}-reference"
native_dir = root / f"artifacts/{args.suite}-native"
selected = [c for c in cases if not args.only or c["id"] in args.only]
if not selected:
    sys.exit(f"No matching cases; known: {', '.join(c['id'] for c in cases)}")

if not args.compare_only:
    if not args.no_build:
        cargo = shutil.which("cargo") or str(Path.home() / ".cargo/bin/cargo")
        subprocess.run([cargo, "build", "--locked", "--features", "dev-capture"], cwd=root, check=True)
    native_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="puppyone-workbench-lab-") as data:
        for case in selected:
            env = {k: v for k, v in os.environ.items() if not k.startswith("PUPPYONE_")}
            env.update(
                PUPPYONE_RUST_DATA_DIR=data,
                PUPPYONE_LAB=lab_prefix + case["id"],
                PUPPYONE_WIDTH=str(case["width"]),
                PUPPYONE_HEIGHT=str(case["height"]),
                PUPPYONE_SCREENSHOT=str(native_dir / f"{case['id']}.png"),
            )
            # A real shell in the lab follows its own preferences; pin the mode.
            env["PUPPYONE_THEME"] = case["mode"]
            # A held motion: the same instant of the 1100ms intro.
            if case.get("intro") is not None:
                env["PUPPYONE_MOTION_AT"] = str(case["intro"] / 1100)
            subprocess.run([str(root / "target/debug/puppy-one-rust")], cwd=root, env=env, check=True, timeout=40)

report = {"tolerance": args.tolerance, "cases": {}}
for case in selected:
    ref_path, nat_path = reference_dir / f"{case['id']}.png", native_dir / f"{case['id']}.png"
    if not ref_path.exists() or not nat_path.exists():
        report["cases"][case["id"]] = {"error": "missing reference or native capture"}
        continue
    a = np.asarray(srgb(Image.open(ref_path)), dtype=np.int16)
    b = np.asarray(srgb(Image.open(nat_path)), dtype=np.int16)
    if a.shape != b.shape:
        report["cases"][case["id"]] = {"error": f"size mismatch {a.shape} vs {b.shape}"}
        continue
    delta = np.abs(a - b).max(axis=2)
    changed = delta > args.tolerance
    # macOS rounds every window's corners (borderless included); the product
    # page has square corners. Ignore the native window's corner masks.
    radius = 14 * 2
    yy, xx = np.mgrid[0:radius, 0:radius]
    outside = (xx - radius) ** 2 + (yy - radius) ** 2 > radius ** 2
    height, width = changed.shape
    for sy, sx, flip_y, flip_x in ((0, 0, False, False), (0, width - radius, False, True),
                                   (height - radius, 0, True, False), (height - radius, width - radius, True, True)):
        mask = outside[::-1 if flip_y else 1, ::-1 if flip_x else 1]
        changed[sy:sy + radius, sx:sx + radius] &= ~mask
    # The borderless window's 1px system edge highlight.
    changed[:2, :] = False
    changed[-2:, :] = False
    changed[:, :2] = False
    changed[:, -2:] = False
    diff = np.zeros_like(a, dtype=np.uint8)
    diff[..., 0] = np.where(changed, 255, 0)
    diff[..., 1] = (b.mean(axis=2) * 0.35).astype(np.uint8)
    diff[..., 2] = (a.mean(axis=2) * 0.35).astype(np.uint8)
    Image.fromarray(diff).save(native_dir / f"{case['id']}.diff.png")
    # Side-by-side: reference | native | diff, for review.
    Image.fromarray(np.concatenate([a.astype(np.uint8), b.astype(np.uint8), diff], axis=1)).save(native_dir / f"{case['id']}.side.png")
    rows = np.where(changed.any(axis=1))[0]
    report["cases"][case["id"]] = {
        "identical": float(1 - changed.mean()),
        "changedPixels": int(changed.sum()),
        "firstChangedRow": int(rows[0]) if rows.size else None,
    }
(native_dir / "report.json").write_text(json.dumps(report, indent=2) + "\n")
for name, result in report["cases"].items():
    if "error" in result:
        print(f"{name:28} {result['error']}")
    else:
        print(f"{name:28} identical {result['identical'] * 100:6.2f}%  changed {result['changedPixels']:>8}  first row {result['firstChangedRow']}")
