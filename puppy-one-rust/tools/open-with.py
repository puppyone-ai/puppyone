#!/usr/bin/env python3
"""Installs `PuppyOne (Rust).app` into `~/Applications` for macOS Finder "Open With".

Mirrors `scripts/desktop/dev/open-with.mjs` for the native GPUI build:
- Declares the File Mode document types (Markdown, CSV, HTML) with `LSHandlerRank = Alternate`.
- When chosen from Finder's "Open With" menu, forwards the selected file(s) over
  `~/Library/Application Support/PuppyOne GPUI/cli/control.sock` (`puppyone open` protocol).
- If no running `puppy-one-rust` instance answers on the socket, starts the local
  `target/debug/puppy-one-rust` (or `target/release/puppy-one-rust`) binary with the file.

Usage:
  python3 tools/open-with.py           # install or refresh
  python3 tools/open-with.py remove    # uninstall
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import sys
import tempfile

OPENER_NAME = "PuppyOne (Rust)"
OPENER_BUNDLE_ID = "ai.puppyone.desktop.rust-open-with"
CLI_CONTROL_PROTOCOL = 1
LSREGISTER = (
    "/System/Library/Frameworks/CoreServices.framework/"
    "Frameworks/LaunchServices.framework/Support/lsregister"
)


def file_mode_extensions(root: Path) -> list[str]:
    registry = json.loads((root / "assets/formats/file-formats.json").read_text())
    extensions = {".html", ".htm"}
    for fmt in registry.get("formats", []):
        if fmt.get("id") in ("markdown", "csv"):
            extensions |= {
                e.lower() for e in fmt.get("extensions", []) if e.startswith(".")
            }
    covered = lambda e: any(o != e and e.endswith(o) for o in extensions)
    return sorted(e for e in extensions if not covered(e))


def control_endpoint() -> Path:
    data_dir = Path(
        os.environ.get(
            "PUPPYONE_RUST_DATA_DIR",
            str(Path.home() / "Library/Application Support/PuppyOne GPUI"),
        )
    )
    preferred = data_dir / "cli/control.sock"
    if len(os.fsencode(preferred)) <= 103:
        return preferred
    import hashlib

    digest = hashlib.sha256(os.fsencode(data_dir)).hexdigest()[:16]
    return Path(f"/tmp/puppyone-cli-{os.getuid()}/{digest}.sock")


def applescript_string(value: str) -> str:
    escaped = value.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{escaped}"'


def create_opener_script(endpoint: Path, root: Path) -> str:
    debug_bin = root / "target/debug/puppy-one-rust"
    release_bin = root / "target/release/puppy-one-rust"
    not_running = (
        "PuppyOne (Rust) is not running and no built binary was found under target/."
    )
    template = r"""on open theItems
	set problem to handOff(theItems)
	if problem is not "" then
		activate
		display dialog problem buttons {"OK"} default button 1 with icon caution
	end if
end open

on run
	activate
	display dialog "Right-click a Markdown, CSV or HTML file in Finder and choose Open With > __OPENER_NAME__." buttons {"OK"} default button 1
end run

on handOff(theItems)
	set requestPaths to {}
	set shellPaths to ""
	repeat with theItem in theItems
		set posixPath to POSIX path of theItem
		set end of requestPaths to jsonString(posixPath)
		set shellPaths to shellPaths & " " & quoted form of posixPath
	end repeat
	set previousDelimiters to AppleScript's text item delimiters
	set AppleScript's text item delimiters to ","
	set request to "{\"protocol\":__PROTOCOL__,\"type\":\"open\",\"paths\":[" & (requestPaths as text) & "]}"
	set AppleScript's text item delimiters to previousDelimiters
	set reached to false
	try
		set reply to do shell script "printf '%s\\n' " & quoted form of request & " | /usr/bin/nc -U " & quoted form of __ENDPOINT__
		if reply contains "\"ok\":true" then
			set reached to true
		end if
	end try
	if reached then
		if reply contains "\"status\":\"rejected\"" then return "__OPENER_NAME__ did not open the file: " & replyMessage(reply)
		return ""
	end if
	try
		do shell script "if [ -x " & quoted form of __DEBUG_BIN__ & " ]; then nohup " & quoted form of __DEBUG_BIN__ & shellPaths & " >/dev/null 2>&1 & elif [ -x " & quoted form of __RELEASE_BIN__ & " ]; then nohup " & quoted form of __RELEASE_BIN__ & shellPaths & " >/dev/null 2>&1 & else exit 1; fi"
		return ""
	on error
		return __NOT_RUNNING__
	end try
end handOff

on replyMessage(reply)
	set marker to "\"message\":\""
	set markerOffset to offset of marker in reply
	if markerOffset is 0 then return reply
	set message to text (markerOffset + (length of marker)) thru -1 of reply
	set messageEnd to offset of "\"" in message
	if messageEnd is 0 then return message
	if messageEnd is 1 then return ""
	return text 1 thru (messageEnd - 1) of message
end replyMessage

on jsonString(value)
	set escaped to value
	repeat with pair in {{"\\", "\\\\"}, {"\"", "\\\""}, {linefeed, "\\n"}, {return, "\\r"}, {tab, "\\t"}}
		set previousDelimiters to AppleScript's text item delimiters
		set AppleScript's text item delimiters to item 1 of pair
		set parts to text items of escaped
		set AppleScript's text item delimiters to item 2 of pair
		set escaped to parts as text
		set AppleScript's text item delimiters to previousDelimiters
	end repeat
	return "\"" & escaped & "\""
end jsonString
"""
    return (
        template.replace("__OPENER_NAME__", OPENER_NAME)
        .replace("__PROTOCOL__", str(CLI_CONTROL_PROTOCOL))
        .replace("__ENDPOINT__", applescript_string(str(endpoint)))
        .replace("__DEBUG_BIN__", applescript_string(str(debug_bin)))
        .replace("__RELEASE_BIN__", applescript_string(str(release_bin)))
        .replace("__NOT_RUNNING__", applescript_string(not_running))
    )


def document_types(root: Path) -> list[dict]:
    open_extensions = file_mode_extensions(root)
    types = [
        {
            "CFBundleTypeName": type_name,
            "LSItemContentTypes": [content_type],
            "CFBundleTypeRole": "Editor",
            "LSHandlerRank": "Alternate",
        }
        for type_name, content_type in [
            ("Markdown", "net.daringfireball.markdown"),
            ("CSV", "public.comma-separated-values-text"),
            ("HTML", "public.html"),
        ]
    ]
    types[0]["CFBundleTypeExtensions"] = [
        e[1:] for e in open_extensions if e not in (".csv", ".htm", ".html")
    ]
    types[1]["CFBundleTypeExtensions"] = ["csv"]
    types[2]["CFBundleTypeExtensions"] = ["html", "htm"]
    return types


def opener_path(applications_dir: Path | None = None) -> Path:
    base = applications_dir or (Path.home() / "Applications")
    return base / f"{OPENER_NAME}.app"


def assert_replaceable(target: Path) -> bool:
    info_path = target / "Contents/Info.plist"
    if not info_path.is_file():
        if target.exists():
            raise SystemExit(
                f"{target} exists but is not an Open With app; leaving it alone."
            )
        return False
    info = plistlib.loads(info_path.read_bytes())
    if info.get("CFBundleIdentifier") != OPENER_BUNDLE_ID:
        raise SystemExit(f"{target} belongs to another app; leaving it alone.")
    return True


def remove_opener(applications_dir: Path | None = None) -> bool:
    target = opener_path(applications_dir)
    if not assert_replaceable(target):
        return False
    subprocess.run([LSREGISTER, "-u", str(target)], check=False)
    shutil.rmtree(target, ignore_errors=True)
    return True


def stop_stale_gui_processes() -> list[int]:
    """Stops running `puppy-one-rust` GUI instances so `control.sock` isn't held by an older build."""
    out = subprocess.run(
        ["/bin/ps", "-ax", "-o", "pid=,command="],
        capture_output=True,
        text=True,
        check=False,
    )
    stopped: list[int] = []
    for line in out.stdout.splitlines():
        parts = line.strip().split(None, 1)
        if len(parts) != 2:
            continue
        pid_str, cmd = parts
        if "puppy-one-rust" not in cmd or "--puppyone-host" in cmd:
            continue
        try:
            pid = int(pid_str)
            os.kill(pid, 15)
            stopped.append(pid)
        except OSError:
            pass
    return stopped


def install_opener(root: Path, applications_dir: Path | None = None) -> Path:
    target = opener_path(applications_dir)
    assert_replaceable(target)
    endpoint = control_endpoint()
    with tempfile.TemporaryDirectory(prefix="puppyone-rust-open-with-") as tmp:
        staging = Path(tmp)
        script_path = staging / "open-with.applescript"
        staged = staging / target.name
        script_path.write_text(create_opener_script(endpoint, root))
        subprocess.run(
            ["/usr/bin/osacompile", "-o", str(staged), str(script_path)], check=True
        )

        info_path = staged / "Contents/Info.plist"
        info = plistlib.loads(info_path.read_bytes())
        info.pop("CFBundleIconName", None)
        info.update(
            {
                "CFBundleIdentifier": OPENER_BUNDLE_ID,
                "CFBundleName": OPENER_NAME,
                "CFBundleDisplayName": OPENER_NAME,
                "CFBundleIconFile": "droplet",
                "CFBundleDocumentTypes": document_types(root),
            }
        )
        info_path.write_bytes(plistlib.dumps(info))

        resources = staged / "Contents/Resources"
        (resources / "Assets.car").unlink(missing_ok=True)
        existing_dev_icon = (
            Path.home()
            / "Applications/PuppyOne (npm run dev).app/Contents/Resources/droplet.icns"
        )
        if existing_dev_icon.is_file():
            shutil.copy2(existing_dev_icon, resources / "droplet.icns")
        subprocess.run(
            ["/usr/bin/codesign", "--force", "--sign", "-", str(staged)], check=True
        )

        remove_opener(applications_dir)
        target.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(["/usr/bin/ditto", str(staged), str(target)], check=True)
        subprocess.run([LSREGISTER, "-f", str(target)], check=True)
    return target


def main() -> None:
    if sys.platform != "darwin":
        raise SystemExit("The Open With helper app is macOS only.")
    root = Path(__file__).resolve().parents[1]
    command = sys.argv[1] if len(sys.argv) > 1 else "install"
    if command == "install":
        stopped = stop_stale_gui_processes()
        if stopped:
            print(f"Stopped running puppy-one-rust process(es): {stopped}")
        target = install_opener(root)
        print(f"Installed {target}")
        for folder in (Path("/Applications"), Path.home() / "Applications"):
            if folder.is_dir():
                for bundle in sorted(folder.glob("*PuppyOne*.app")):
                    print(f"Found app bundle: {bundle}")
        print(
            f"Right-click any Markdown, CSV or HTML file > Open With > {OPENER_NAME}."
        )
    elif command == "remove":
        if remove_opener():
            print(f"Removed {opener_path()}")
        else:
            print("Nothing to remove.")
    else:
        raise SystemExit(f"Unknown command: {command}. Use install or remove.")


if __name__ == "__main__":
    main()
