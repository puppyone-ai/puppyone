#!/usr/bin/env python3
"""Import what a release bundle shows from the product into assets/release/:
the App Image per channel (`app-icon-contract.mjs`), the derived GPUI Blue-`D`
development App Image (`puppy-app-image-gpui-dev.png`), and the DMG window's
background (`assets/installer`).

    python3 tools/import-release-assets.py [--check]
"""
from pathlib import Path
import struct
import sys
import zlib

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / 'tools'))
from product_source import product_root  # noqa: E402

ASSETS = {
    'assets/brand/puppy/puppy-app-image.png': 'puppy-app-image.png',
    'assets/brand/puppy/puppy-app-image-dev.png': 'puppy-app-image-dev.png',
    'assets/installer/dmg-background.tiff': 'dmg-background.tiff',
}

# TS development badge yellow (#FFBD2A) -> GPUI development badge sky blue (#38BDF8).
TS_BADGE_YELLOW = (255, 189, 42)
GPUI_BADGE_BLUE = (56, 189, 248)
DERIVED_GPUI_DEV_ICON = 'puppy-app-image-gpui-dev.png'


def decode_png_rgba(data: bytes) -> tuple[int, int, bytearray]:
    if data[:8] != b'\x89PNG\r\n\x1a\n':
        raise ValueError('Not a PNG file')
    pos = 8
    chunks = []
    width = height = 0
    while pos < len(data):
        length = struct.unpack('>I', data[pos:pos + 4])[0]
        ctype = data[pos + 4:pos + 8]
        cdata = data[pos + 8:pos + 8 + length]
        pos += 12 + length
        if ctype == b'IHDR':
            width, height, bit_depth, color_type, _, _, interlace = struct.unpack('>IIBBBBB', cdata)
            if (bit_depth, color_type, interlace) != (8, 6, 0):
                raise ValueError('Expected non-interlaced 8-bit RGBA PNG')
        elif ctype == b'IDAT':
            chunks.append(cdata)
    raw = zlib.decompress(b''.join(chunks))
    stride = width * 4
    out = bytearray(width * height * 4)
    offset = 0
    for y in range(height):
        filt = raw[offset]
        offset += 1
        row = bytearray(raw[offset:offset + stride])
        offset += stride
        prev = out[(y - 1) * stride:y * stride] if y > 0 else bytes(stride)
        if filt == 1:
            for x in range(4, stride):
                row[x] = (row[x] + row[x - 4]) & 0xFF
        elif filt == 2:
            for x in range(stride):
                row[x] = (row[x] + prev[x]) & 0xFF
        elif filt == 3:
            for x in range(stride):
                left = row[x - 4] if x >= 4 else 0
                row[x] = (row[x] + ((left + prev[x]) >> 1)) & 0xFF
        elif filt == 4:
            for x in range(stride):
                a = row[x - 4] if x >= 4 else 0
                b = prev[x]
                c = prev[x - 4] if x >= 4 else 0
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pr = a if pa <= pb and pa <= pc else (b if pb <= pc else c)
                row[x] = (row[x] + pr) & 0xFF
        out[y * stride:(y + 1) * stride] = row
    return width, height, out


def encode_png_rgba(width: int, height: int, rgba: bytes) -> bytes:
    stride = width * 4
    raw = bytearray()
    for y in range(height):
        raw.append(0)
        raw.extend(rgba[y * stride:(y + 1) * stride])
    compressed = zlib.compress(bytes(raw), 9)

    def chunk(ctype: bytes, cdata: bytes) -> bytes:
        crc = zlib.crc32(ctype + cdata) & 0xFFFFFFFF
        return struct.pack('>I', len(cdata)) + ctype + cdata + struct.pack('>I', crc)

    ihdr = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr) + chunk(b'IDAT', compressed) + chunk(b'IEND', b'')


def derive_gpui_dev_icon(base_png: bytes, ts_dev_png: bytes) -> bytes:
    width, height, base = decode_png_rgba(base_png)
    dev_w, dev_h, dev = decode_png_rgba(ts_dev_png)
    if (width, height) != (dev_w, dev_h):
        raise ValueError('Base and dev App Images must share dimensions')

    bx0, by0, bx1, by1 = width, height, 0, 0
    for y in range(height):
        for x in range(width):
            i = (y * width + x) * 4
            r, _, b, a = dev[i], dev[i + 1], dev[i + 2], dev[i + 3]
            if a > 0 and r - b > 25:
                bx0, by0 = min(bx0, x), min(by0, y)
                bx1, by1 = max(bx1, x), max(by1, y)

    out = bytearray(dev)
    yr, yg, yb = TS_BADGE_YELLOW
    br_target, bg_target, bb_target = GPUI_BADGE_BLUE
    for y in range(max(0, by0 - 4), min(height, by1 + 5)):
        for x in range(max(0, bx0 - 4), min(width, bx1 + 5)):
            i = (y * width + x) * 4
            r, g, b, a = dev[i], dev[i + 1], dev[i + 2], dev[i + 3]
            if (r, g, b, a) == (base[i], base[i + 1], base[i + 2], base[i + 3]):
                continue
            ref_rb = 9.0 if g > 190 else 0.0
            t = max(0.0, min(1.0, (r - b - ref_rb) / (float(yr - yb) - ref_rb)))
            out[i] = int(round(max(0.0, min(255.0, r + t * (br_target - yr)))))
            out[i + 1] = int(round(max(0.0, min(255.0, g + t * (bg_target - yg)))))
            out[i + 2] = int(round(max(0.0, min(255.0, b + t * (bb_target - yb)))))
    return encode_png_rgba(width, height, out)


product = product_root()
target = root / 'assets/release'
stale = []
for source, name in ASSETS.items():
    data = (product / source).read_bytes()
    if not (target / name).is_file() or (target / name).read_bytes() != data:
        stale.append(name)
        if '--check' not in sys.argv:
            (target / name).write_bytes(data)

derived_bytes = derive_gpui_dev_icon(
    (product / 'assets/brand/puppy/puppy-app-image.png').read_bytes(),
    (product / 'assets/brand/puppy/puppy-app-image-dev.png').read_bytes(),
)
derived_path = target / DERIVED_GPUI_DEV_ICON
if not derived_path.is_file() or derived_path.read_bytes() != derived_bytes:
    stale.append(DERIVED_GPUI_DEV_ICON)
    if '--check' not in sys.argv:
        derived_path.write_bytes(derived_bytes)

if '--check' in sys.argv and stale:
    raise SystemExit(f'Stale release assets {stale}: run python3 tools/import-release-assets.py')
total = len(ASSETS) + 1
print(f'{total} release assets ' + ('checked' if '--check' in sys.argv else 'imported'))
