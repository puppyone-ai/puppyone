"""The installer disk image and the update archive (`macos.mjs` `dmg`, the
`zip` target): the app beside an /Applications link on the product's
background, laid out by Finder, then compressed; and the app archived with
ditto for the updater. Both are made after the app is signed and stapled."""
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

WINDOW = (720, 440)
ICON_SIZE = 128
TEXT_SIZE = 14
APP_POSITION = (200, 204)
APPLICATIONS_POSITION = (520, 204)

LAYOUT = '''
tell application "Finder"
  tell disk "{volume}"
    open
    set current view of container window to icon view
    set toolbar visible of container window to false
    set statusbar visible of container window to false
    set the bounds of container window to {{120, 120, {right}, {bottom}}}
    set viewOptions to the icon view options of container window
    set arrangement of viewOptions to not arranged
    set icon size of viewOptions to {icon_size}
    set text size of viewOptions to {text_size}
    set background picture of viewOptions to file ".background:dmg-background.tiff"
    set position of item "{app}" of container window to {{{app_x}, {app_y}}}
    set position of item "Applications" of container window to {{{apps_x}, {apps_y}}}
    close
    open
    update without registering applications
    delay 1
    close
  end tell
end tell
'''


def _run(command):
    return subprocess.run(command, check=True, text=True, capture_output=True).stdout


def create(app, destination, volume, background):
    """`destination` (.dmg). Finder lays the window out when this process may
    automate it; otherwise the image keeps Finder's default layout, with a
    warning."""
    app = Path(app)
    with tempfile.TemporaryDirectory(prefix='puppyone-dmg-') as directory:
        staging = Path(directory) / 'staging'
        staging.mkdir()
        _run(['ditto', str(app), str(staging / app.name)])
        (staging / 'Applications').symlink_to('/Applications')
        (staging / '.background').mkdir()
        shutil.copyfile(background, staging / '.background/dmg-background.tiff')
        writable = Path(directory) / 'writable.dmg'
        _run(['hdiutil', 'create', '-volname', volume, '-srcfolder', str(staging), '-ov',
              '-format', 'UDRW', '-fs', 'HFS+', str(writable)])
        attached = _run(['hdiutil', 'attach', '-readwrite', '-noverify', '-noautoopen', str(writable)])
        mount = next(line.split('\t')[-1].strip() for line in attached.splitlines() if '/Volumes/' in line)
        try:
            script = LAYOUT.format(volume=volume, right=120 + WINDOW[0], bottom=120 + WINDOW[1],
                                   icon_size=ICON_SIZE, text_size=TEXT_SIZE, app=app.name,
                                   app_x=APP_POSITION[0], app_y=APP_POSITION[1],
                                   apps_x=APPLICATIONS_POSITION[0], apps_y=APPLICATIONS_POSITION[1])
            layout = subprocess.run(['osascript', '-e', script], capture_output=True, text=True, timeout=120)
            if layout.returncode:
                print(f'warning: Finder could not lay out the disk image ({layout.stderr.strip()}); '
                      'it keeps the default layout', file=sys.stderr)
            subprocess.run(['chmod', '-Rf', 'go-w', mount], capture_output=True)
            subprocess.run(['bless', '--folder', mount], capture_output=True)
        finally:
            for attempt in range(5):
                if subprocess.run(['hdiutil', 'detach', mount], capture_output=True).returncode == 0:
                    break
                time.sleep(2)
            else:
                _run(['hdiutil', 'detach', '-force', mount])
        destination = Path(destination)
        destination.unlink(missing_ok=True)
        _run(['hdiutil', 'convert', str(writable), '-format', 'UDZO', '-imagekey', 'zlib-level=9',
              '-o', str(destination)])
    return destination


def archive(app, destination):
    """The update archive: the stapled app, resource forks sequestered."""
    destination = Path(destination)
    destination.unlink(missing_ok=True)
    _run(['ditto', '-c', '-k', '--sequesterRsrc', '--keepParent', str(app), str(destination)])
    return destination
