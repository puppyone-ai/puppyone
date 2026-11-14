"""`macos-app-icon.mjs`: the channel's 1024 px App Image as `icon.icns`,
built with Apple's own iconset toolchain and decoded again to check that
every representation is there and the 1024 px one is the artwork itself."""
import shutil
import struct
import subprocess
import tempfile
from pathlib import Path

REPRESENTATIONS = [(f'icon_{size}x{size}{"@2x" if scale == 2 else ""}.png', size * scale)
                   for size in (16, 32, 128, 256, 512) for scale in (1, 2)]


def png_size(data):
    if data[:8] != b'\x89PNG\r\n\x1a\n' or data[12:16] != b'IHDR':
        raise ValueError('Not a PNG image')
    return struct.unpack('>II', data[16:24])


def build(source, destination):
    data = Path(source).read_bytes()
    if png_size(data) != (1024, 1024):
        raise ValueError(f'{source} must be a 1024×1024 PNG')
    with tempfile.TemporaryDirectory(prefix='puppyone-icon-') as staging:
        iconset = Path(staging) / 'app.iconset'
        iconset.mkdir()
        snapshot = Path(staging) / 'source.png'
        snapshot.write_bytes(data)
        for name, pixels in REPRESENTATIONS:
            output = iconset / name
            if pixels == 1024:
                shutil.copyfile(snapshot, output)
            else:
                subprocess.run(['/usr/bin/sips', '-z', str(pixels), str(pixels), str(snapshot),
                                '--out', str(output)], check=True, capture_output=True)
        generated = Path(staging) / 'icon.icns'
        subprocess.run(['/usr/bin/iconutil', '-c', 'icns', str(iconset), '-o', str(generated)], check=True)
        verify(generated, data)
        shutil.copyfile(generated, destination)


def verify(icns, source):
    contents = Path(icns).read_bytes()
    if contents[:4] != b'icns' or struct.unpack('>I', contents[4:8])[0] != len(contents):
        raise ValueError(f'{icns} is not a valid ICNS container')
    with tempfile.TemporaryDirectory(prefix='puppyone-verify-icon-') as temporary:
        iconset = Path(temporary) / 'decoded.iconset'
        subprocess.run(['/usr/bin/iconutil', '-c', 'iconset', str(icns), '-o', str(iconset)], check=True)
        for name, pixels in REPRESENTATIONS:
            image = (iconset / name).read_bytes()
            if png_size(image) != (pixels, pixels):
                raise ValueError(f'{name} is not {pixels} px')
        if png_size(source) != (1024, 1024):
            raise ValueError('The App Image is not 1024 px')
