#!/usr/bin/env python3
"""Development asset conversion; not a runtime dependency.
Requires fonttools[woff] (tested with fontTools 4.63.0).
"""
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

root = Path(__file__).resolve().parents[1]
font = TTFont(root.parent / "public/fonts/geist/Geist-Variable.woff2")
font = instantiateVariableFont(font, {"wght": 400}, inplace=True)
font.flavor = None
font.save(root / "assets/Geist-Regular.ttf")
