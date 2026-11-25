"""`macos-app-icon.mjs`: the channel's 1024 px App Image as `icon.icns`,
built with Apple's own iconset toolchain and decoded again to check that
every representation is there and the 1024 px one is the artwork itself."""
import plistlib
import shutil
import struct
import subprocess
import tempfile
from pathlib import Path

import identity

ROOT = Path(__file__).resolve().parents[2]

REPRESENTATIONS = [(f'icon_{size}x{size}{"@2x" if scale == 2 else ""}.png', size * scale)
                   for size in (16, 32, 128, 256, 512) for scale in (1, 2)]


def png_size(data):
    if data[:8] != b'\x89PNG\r\n\x1a\n' or data[12:16] != b'IHDR':
        raise ValueError('Not a PNG image')
    return struct.unpack('>II', data[16:24])


def source_for(channel):
    """The channel's App Image (`resolveDesktopAppIcon`)."""
    return ROOT / 'assets/release' / identity.policy(channel)['icon']


def build_inputs(channel, source, destination):
    """`resolveMacosIconBuildInputs`: only the channel's canonical PNG, and
    only into an app bundle's `Contents/Resources/icon.icns`."""
    canonical = source_for(channel)
    if Path(source).resolve() != canonical.resolve():
        raise ValueError(f'The {channel} icon is built from its canonical PNG {canonical.name} only')
    destination = Path(destination)
    resources = destination.parent
    if (destination.name != 'icon.icns' or resources.name != 'Resources'
            or resources.parent.name != 'Contents' or resources.parent.parent.suffix != '.app'):
        raise ValueError(f'The icon is written only into an app bundle\'s Contents/Resources: {destination}')
    return canonical, destination


def build_for(channel, app):
    """The channel's `icon.icns` inside `app`."""
    build(*build_inputs(channel, source_for(channel), Path(app) / 'Contents/Resources/icon.icns'))


def verify_app(app, channel):
    """`verifyMacosIconAfterPack`: the bundle names `icon.icns` as its icon,
    and both it and `puppy-app-image.png` are this channel's App Image."""
    contents = Path(app) / 'Contents'
    info = plistlib.loads((contents / 'Info.plist').read_bytes())
    if info.get('CFBundleIconFile') != 'icon.icns' or 'CFBundleIconName' in info:
        raise ValueError('CFBundleIconFile must name icon.icns, with no CFBundleIconName')
    resources = contents / 'Resources'
    for name in ('icon.icns', 'puppy-app-image.png'):
        if not (resources / name).is_file():
            raise FileNotFoundError(f'{name} is missing from {resources}')
    image = (resources / 'puppy-app-image.png').read_bytes()
    if image != source_for(channel).read_bytes():
        raise ValueError(f'puppy-app-image.png is not the selected channel\'s ({channel}) App Image')
    verify(resources / 'icon.icns', image)


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
            if not (iconset / name).is_file():
                raise ValueError(f'{name} is missing')
            image = (iconset / name).read_bytes()
            if png_size(image) != (pixels, pixels):
                raise ValueError(f'{name} is not {pixels} px')
        if png_size(source) != (1024, 1024):
            raise ValueError('The App Image is not 1024 px')
        # Stale or substituted artwork: the 1024 px representation shows the
        # channel's App Image itself, pixel for pixel (iconutil re-encodes it).
        if _pixels(iconset / 'icon_512x512@2x.png') != _pixels_of(source, temporary):
            raise ValueError(f'{icns} does not carry this channel\'s App Image')


def _pixels_of(data, directory):
    path = Path(directory) / 'source.png'
    path.write_bytes(bytes(data))
    return _pixels(path)


def _pixels(png):
    """The decoded pixels: a bitmap `sips` writes, without its header."""
    with tempfile.TemporaryDirectory(prefix='puppyone-pixels-') as temporary:
        bitmap = Path(temporary) / 'image.bmp'
        subprocess.run(['/usr/bin/sips', '-s', 'format', 'bmp', str(png), '--out', str(bitmap)],
                       check=True, capture_output=True)
        data = bitmap.read_bytes()
        return data[struct.unpack('<I', data[10:14])[0]:]
