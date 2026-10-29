#!/usr/bin/env python3
"""Static editor font instances from the product's own variable fonts.

The product renders editor text with Geist Sans / Geist Mono variable fonts at
fractional CSS weights (500, 600, 625, 650) and synthesises oblique italics
(Geist has no italic). GPUI selects faces by family and weight, so each weight
becomes its own family ("PuppyOne Geist 625") and the native style asks for the
exact family while keeping the CSS weight for system fallback (PingFang SC).
Oblique faces skew outlines like Chromium's synthetic italic.

  python3 tools/import-editor-fonts.py [--check]   (requires fontTools[woff])
"""
import hashlib
import io
import json
import math
from pathlib import Path
import sys

from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

root = Path(__file__).resolve().parents[1]
config = json.loads((root / 'product-source.json').read_text())
product = (root / config['checkout']).resolve()
out = root / 'assets/fonts/editor'
# Weights used by the Markdown/CSV theme contract (content 500, strong/h3 600,
# h2 625, h1/table header/metadata 650, list markers 400) plus 700 for bold
# inside monospaced code, and the reading weight (`--po-content-reading-weight`,
# 450) of chat messages and the Typography preview. Italic: emphasis at body
# and heading/strong weights.
SANS = {'weights': [400, 450, 500, 600, 625, 650, 700], 'oblique': [400, 450, 500, 600, 625, 650, 700]}
MONO = {'weights': [400, 450, 500, 600, 700], 'oblique': [450, 500, 600]}
# Chromium (Skia) synthetic italic: horizontal skew of 1/4 em per em.
SKEW = 0.25
# GPUI Kit renders a bold mark as weight 700 in the line's family. Body text
# (500) is strong at the product's `--po-md-strong-weight` (600), so the 500
# family carries Geist 600 outlines in its Bold slot (and Bold Oblique).
BOLD_SLOTS = {450: 600, 500: 600}
# GPUI Kit draws an inline-code mark in the theme's mono family at 0.875 of
# the text size; the product's inline code keeps the full size
# (`--po-md-inline-code-font-size` unset). The editor's mono family for that
# mark ("PuppyOne Geist Mono Inline") therefore has 875 units per em: at
# 0.875 × size it renders exactly Geist Mono at `size`.
INLINE_CODE_UPEM = 875
# The code viewer's family (400) also carries its token weights
# (`code-editor.css`): functions at 550 as its Medium face, keywords at 600
# as its SemiBold face, so a highlight weight selects real outlines.
CODE_FACES = {'medium': (550, 'Medium', 500), 'semibold': (600, 'SemiBold', 600)}


def rename(font, family, style, weight, italic, bold=False):
    name = font['name']
    full = f'{family} {style}'.strip()
    ps = full.replace(' ', '')
    for record in list(name.names):
        if record.nameID in (1, 2, 3, 4, 6, 16, 17, 21, 22, 25):
            name.removeNames(nameID=record.nameID)
    for name_id, value in [(1, family), (2, style), (3, f'{ps};puppyone-editor'), (4, full), (6, ps), (16, family), (17, style)]:
        name.setName(value, name_id, 3, 1, 0x409)
        name.setName(value, name_id, 1, 0, 0)
    os2 = font['OS/2']
    os2.usWeightClass = weight
    selection = os2.fsSelection & ~0b1100001  # clear ITALIC, BOLD, REGULAR
    selection |= (0b1 if italic else 0) | (0b100000 if bold else 0)
    if not italic and not bold:
        selection |= 0b1000000
    os2.fsSelection = selection
    font['head'].macStyle = (0b10 if italic else 0) | (0b1 if bold else 0)
    font['post'].italicAngle = -math.degrees(math.atan(SKEW)) if italic else 0.0
    if 'STAT' in font:
        del font['STAT']


def oblique(font):
    glyph_set = font.getGlyphSet()
    glyf = font['glyf']
    for glyph_name in font.getGlyphOrder():
        recording = DecomposingRecordingPen(glyph_set)
        glyph_set[glyph_name].draw(recording)
        pen = TTGlyphPen(None)
        recording.replay(TransformPen(pen, (1, 0, SKEW, 1, 0, 0)))
        glyph = pen.glyph()
        glyf[glyph_name] = glyph
    font['hhea'].caretSlopeRise = 1000
    font['hhea'].caretSlopeRun = round(1000 * SKEW)
    font['glyf'].compile(font)


def build(source, family, weight, italic, slot=None, upem=None, name=None, face=None):
    """`slot`: build `weight` outlines as the Bold face of family `slot`;
    `upem`/`name`: rescale the em and use the family `name` (inline code);
    `face`: (style, weight class) of an extra face in the 400 family."""
    font = TTFont(io.BytesIO(source))
    font = instantiateVariableFont(font, {'wght': weight}, inplace=False)
    font.flavor = None
    if italic:
        oblique(font)
    if upem is not None:
        font['head'].unitsPerEm = upem
    if face is not None:
        rename(font, f'{family} 400', face[0], face[1], False)
    elif name is not None:
        bold = slot is not None
        style = ('Bold ' if bold else '') + ('Oblique' if italic else ('' if bold else 'Regular'))
        rename(font, name, style.strip(), 700 if bold else weight, italic, bold=bold)
    elif slot is None:
        style = 'Oblique' if italic else 'Regular'
        rename(font, f'{family} {weight}', style, weight, italic)
    else:
        style = 'Bold Oblique' if italic else 'Bold'
        rename(font, f'{family} {slot}', style, 700, italic, bold=True)
    # Deterministic output: keep the source timestamps.
    font.recalcTimestamp = False
    font['head'].modified = font['head'].created
    buffer = io.BytesIO()
    font.save(buffer)
    return buffer.getvalue()


def main():
    check = '--check' in sys.argv
    files = {}
    for family, path, spec in [('PuppyOne Geist', 'public/fonts/geist/Geist-Variable.woff2', SANS),
                               ('PuppyOne Geist Mono', 'public/fonts/geist/GeistMono-Variable.woff2', MONO)]:
        source = (product / path).read_bytes()
        slug = family.split()[-1].lower() if 'Mono' in family else 'sans'
        for weight in spec['weights']:
            files[f'geist-{slug}-{weight}.ttf'] = build(source, family, weight, False)
        for weight in spec['oblique']:
            files[f'geist-{slug}-{weight}-oblique.ttf'] = build(source, family, weight, True)
        if slug == 'mono':
            for key, (weight, style, weight_class) in CODE_FACES.items():
                files[f'geist-mono-400-{key}.ttf'] = build(source, family, weight, False, face=(style, weight_class))
            inline = 'PuppyOne Geist Mono Inline'
            files['geist-mono-inline.ttf'] = build(source, family, 500, False, upem=INLINE_CODE_UPEM, name=inline)
            files['geist-mono-inline-oblique.ttf'] = build(source, family, 500, True, upem=INLINE_CODE_UPEM, name=inline)
            files['geist-mono-inline-bold.ttf'] = build(source, family, 600, False, slot=500, upem=INLINE_CODE_UPEM, name=inline)
            files['geist-mono-inline-bold-oblique.ttf'] = build(source, family, 600, True, slot=500, upem=INLINE_CODE_UPEM, name=inline)
            # Latin document content inherits 450, not the CJK sample's 500.
            reading = 'PuppyOne Geist Mono Inline Reading'
            files['geist-mono-inline-reading.ttf'] = build(source, family, 450, False, upem=INLINE_CODE_UPEM, name=reading)
            files['geist-mono-inline-reading-oblique.ttf'] = build(source, family, 450, True, upem=INLINE_CODE_UPEM, name=reading)
            files['geist-mono-inline-reading-bold.ttf'] = build(source, family, 600, False, slot=450, upem=INLINE_CODE_UPEM, name=reading)
            files['geist-mono-inline-reading-bold-oblique.ttf'] = build(source, family, 600, True, slot=450, upem=INLINE_CODE_UPEM, name=reading)
        if slug == 'sans':
            for regular, strong in BOLD_SLOTS.items():
                files[f'geist-sans-{regular}-bold.ttf'] = build(source, family, strong, False, slot=regular)
                files[f'geist-sans-{regular}-bold-oblique.ttf'] = build(source, family, strong, True, slot=regular)
    # CSS `ch` (advance of "0", in em) per face: list marker rails use it.
    zero = {}
    for name, data in sorted(files.items()):
        font = TTFont(io.BytesIO(data))
        glyph = font.getBestCmap()[ord('0')]
        zero[name] = font['hmtx'][glyph][0] / font['head'].unitsPerEm
    manifest = {'source': 'product public/fonts/geist (SIL OFL 1.1)', 'skew': SKEW,
                'files': {name: hashlib.sha256(data).hexdigest() for name, data in sorted(files.items())},
                'zeroAdvance': zero}
    if check:
        recorded = json.loads((out / 'manifest.json').read_text())
        if recorded != manifest:
            sys.exit('Stale editor fonts: run python3 tools/import-editor-fonts.py')
        print(f'Editor fonts verified ({len(files)} faces)')
        return
    out.mkdir(parents=True, exist_ok=True)
    for name, data in files.items():
        (out / name).write_bytes(data)
    (out / 'manifest.json').write_text(json.dumps(manifest, indent=1) + '\n')
    print(f'Wrote {len(files)} editor faces to {out.relative_to(root)}')


main()
