#!/usr/bin/env python3
"""Development only: derive static weights from the repository's OFL font.
Requires fonttools[woff]. No runtime download or font conversion.
"""
from pathlib import Path
import shutil
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

root = Path(__file__).resolve().parents[1]
source = root.parent.parent / 'public/fonts/geist/Geist-Variable.woff2'
(root / 'assets').mkdir(exist_ok=True)
for name, weight in [('Regular', 400), ('Bold', 700)]:
    font = instantiateVariableFont(TTFont(source), {'wght': weight}, inplace=True)
    # This source has no STAT Axis Values for automatic instance naming.
    # CoreText/GPUI needs unique PostScript names and correct style metadata.
    names = {1: 'Geist', 2: name, 3: f'Geist-{name};Static-{weight}',
             4: f'Geist {name}', 6: f'Geist-{name}', 16: 'Geist', 17: name}
    encodings = {(n.platformID, n.platEncID, n.langID) for n in font['name'].names}
    for platform_id, encoding, language in encodings:
        for name_id, value in names.items():
            font['name'].setName(value, name_id, platform_id, encoding, language)
    font['OS/2'].fsSelection = (font['OS/2'].fsSelection & ~0x60) | (0x20 if weight == 700 else 0x40)
    font['head'].macStyle = (font['head'].macStyle & ~1) | int(weight == 700)
    assert font['name'].getDebugName(6) == f'Geist-{name}'
    font.flavor = None
    font.save(root / f'assets/Geist-{name}.ttf')
shutil.copyfile(root.parent / 'assets/Geist-OFL.txt', root / 'assets/Geist-OFL.txt')

# GPUI matches real faces rather than synthesizing italic. Reuse the product's
# complete Open Sans family for the rich-text content area.
for style in ['Regular', 'Bold', 'Italic', 'BoldItalic']:
    font = TTFont(root.parent.parent / f'public/fonts/open-sans/OpenSans-{style}.woff2')
    font.flavor = None
    font.save(root / f'assets/OpenSans-{style}.ttf')
shutil.copyfile(root.parent.parent / 'public/fonts/open-sans/OFL.txt', root / 'assets/OpenSans-OFL.txt')
