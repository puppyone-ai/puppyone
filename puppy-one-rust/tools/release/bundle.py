"""Assembling the GPUI app bundle around a built executable: its frameworks
and resources, and the Info.plist keys every bundle declares (the files a
file window opens, what `puppyone open` reads). Shared by the local
workbench packaging and the release packaging.
"""
import hashlib
import json
import plistlib
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EXECUTABLE = 'puppy-one-rust'


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def file_mode_extensions():
    """`createFileModeExtensions` over the bundled format registry."""
    registry = json.loads((ROOT / 'assets/formats/file-formats.json').read_text())
    extensions = {'.html', '.htm'}
    for fmt in registry.get('formats', []):
        if fmt.get('id') in ('markdown', 'csv'):
            extensions |= {e.lower() for e in fmt.get('extensions', []) if e.startswith('.')}
    covered = lambda e: any(o != e and e.endswith(o) for o in extensions)
    return sorted(e for e in extensions if not covered(e))


def document_types():
    """`FILE_MODE_DOCUMENT_TYPES` (`macos.mjs`): the files a file window
    opens, joining the system's list without claiming the default app. No
    folder type: a folder arrives through `open -a` or a second launch."""
    types = [
        {'CFBundleTypeName': type_name, 'LSItemContentTypes': [content_type],
         'CFBundleTypeRole': 'Editor', 'LSHandlerRank': 'Alternate'}
        for type_name, content_type in [
            ('Markdown', 'net.daringfireball.markdown'),
            ('CSV', 'public.comma-separated-values-text'),
            ('HTML', 'public.html'),
        ]
    ]
    open_extensions = file_mode_extensions()
    types[0]['CFBundleTypeExtensions'] = [e[1:] for e in open_extensions
                                          if e not in ('.csv', '.htm', '.html')]
    types[1]['CFBundleTypeExtensions'] = ['csv']
    types[2]['CFBundleTypeExtensions'] = ['html', 'htm']
    return types


def cli_declaration():
    """`CLI_INFO_PLIST_KEYS`: what `puppyone open` reads before it starts the
    app; the data directory names the control socket."""
    return {'PuppyOneCliProtocol': 1, 'PuppyOneCliUserDataName': 'PuppyOne GPUI',
            'PuppyOneOpenExtensions': file_mode_extensions(), 'PuppyOneOpenMaxBytes': 1024 * 1024}


def assemble(app, binary, info, environment=None, resources=None):
    """Writes `app` around `binary`: PDFium in Frameworks, the whiteboard's
    fonts and the licences in Resources, `resources` (name → bytes) beside
    them, and `info` as Info.plist."""
    contents = Path(app) / 'Contents'
    executable = contents / 'MacOS' / EXECUTABLE
    resource_dir = contents / 'Resources'
    executable.parent.mkdir(parents=True, exist_ok=True)
    resource_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy2(binary, executable)
    # PDFium (tools/fetch-pdfium.py): the PDF viewer looks in ../Frameworks.
    pdfium = ROOT / 'vendor/pdfium/lib/libpdfium.dylib'
    if pdfium.is_file():
        frameworks = contents / 'Frameworks'
        frameworks.mkdir(parents=True, exist_ok=True)
        shutil.copy2(pdfium, frameworks / pdfium.name)
        shutil.copy2(ROOT / 'vendor/pdfium/LICENSE', resource_dir / 'PDFIUM_LICENSE.txt')
    # The whiteboard's fonts (tools/fetch-excalidraw-fonts.py), served from
    # Resources/excalidraw; a bundle without them draws text in system fonts.
    fonts = ROOT / 'vendor/excalidraw/fonts'
    if fonts.is_dir():
        subprocess.run([sys.executable, str(ROOT / 'tools/fetch-excalidraw-fonts.py'), '--check'], check=True)
        shutil.copytree(fonts, resource_dir / 'excalidraw/fonts', dirs_exist_ok=True)
    else:
        print('warning: no Excalidraw fonts; run tools/fetch-excalidraw-fonts.py', file=sys.stderr)
    for source, destination in [
        (ROOT / 'licenses/excalidraw/LICENSE', 'EXCALIDRAW_LICENSE.txt'),
        (ROOT / 'licenses/excalidraw/FONT-NOTICES.txt', 'EXCALIDRAW_FONT_NOTICES.txt'),
        (ROOT / 'licenses/render-service/MERMAID_LICENSE.txt', 'MERMAID_LICENSE.txt'),
        (ROOT / 'licenses/render-service/KATEX_LICENSE.txt', 'KATEX_LICENSE.txt'),
        (ROOT / 'README.md', 'README.md'),
        (ROOT / 'THIRD_PARTY.md', 'THIRD_PARTY.md'),
        (ROOT.parent / 'LICENSE', 'LICENSE'),
        (ROOT / 'assets/OpenSans-OFL.txt', 'OpenSans-OFL.txt'),
        (ROOT / 'assets/agents/lobe-icons-license.txt', 'AGENT_ICONS_LICENSE.txt'),
    ]:
        shutil.copy2(source, resource_dir / destination)
    for name, data in (resources or {}).items():
        (resource_dir / name).write_bytes(data)
    info = dict(info)
    if environment:
        info['LSEnvironment'] = environment
    with (contents / 'Info.plist').open('wb') as f:
        plistlib.dump(info, f)
    if digest(executable) != digest(binary):
        raise SystemExit(f'Packaged binary mismatch: {app}')
