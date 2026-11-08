#!/usr/bin/env node
/**
 * Puts `npm run dev` in the macOS Open With menu.
 *
 * macOS offers only installed apps that declare file types, and the dev build
 * runs inside a generic Electron.app that declares none. This installs a small
 * AppleScript app carrying the packaged build's editor declarations. Choosing it asks
 * the running dev instance to open the file over the per-user socket
 * `puppyone open` uses, so the File Mode window loads from the Vite server and
 * style edits apply live, without packaging.
 *
 * The app only knows that socket, which belongs to the dev channel's user
 * data, not to a checkout: it reaches whichever checkout or worktree is
 * running `npm run dev`, and keeps working after any of them is deleted.
 *
 *   npm run dev:open-with          install or refresh
 *   npm run dev:open-with:remove   uninstall
 */
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import plist from "plist";
import { resolveCliControlEndpoint } from "../../../electron/main/cli-control/endpoint.mjs";
import { CLI_CONTROL_PROTOCOL } from "../../../shared/cli-control-contract/protocol.mjs";
import { getDesktopBuildChannelPolicy } from "../../../shared/desktop-build-identity.mjs";
import { resolveDesktopAppIcon } from "../../../shared/desktop/app-icon-contract.mjs";
import { buildMacosAppIcon } from "../build/macos-app-icon.mjs";
import { FILE_MODE_DOCUMENT_TYPES } from "../build/platforms/macos.mjs";

export const OPENER_NAME = "PuppyOne (npm run dev)";
export const OPENER_BUNDLE_ID = "ai.puppyone.desktop.dev-open-with";
export const DEV_NOT_RUNNING_MESSAGE = "PuppyOne isn't running from npm run dev. Start it (for example npm run dev:qubits), then open the file again.";

const LSREGISTER = "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";
const run = promisify(execFile);

/** Where every `npm run dev` instance of this user listens, whichever checkout it runs from. */
export function devControlEndpoint({ homeDirectory = os.homedir(), uid = process.getuid?.() ?? null } = {}) {
  const userDataPath = path.join(homeDirectory, "Library", "Application Support", getDesktopBuildChannelPolicy("dev").userDataName);
  return resolveCliControlEndpoint({ userDataPath, platform: "darwin", uid });
}

export function appleScriptString(value) {
  return `"${String(value).replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")}"`;
}

/**
 * The Open With app. `handOff` returns what went wrong, or "" once the dev
 * instance has opened every file; only `open` talks to the user, so the
 * hand-off can be checked without a dialog. A missing dev instance is reported
 * instead of starting a second, unrelated app.
 */
export function createOpenerScript({ endpoint }) {
  // Raw, so this text is the AppleScript source exactly as written.
  return String.raw`on open theItems
	set problem to handOff(theItems)
	if problem is not "" then
		activate
		display dialog problem buttons {"OK"} default button 1 with icon caution
	end if
end open

on run
	activate
	display dialog "Choose ${OPENER_NAME} from a file's Open With menu. The file opens in the running npm run dev instance." buttons {"OK"} default button 1
end run

on handOff(theItems)
	set requestPaths to {}
	repeat with theItem in theItems
		set end of requestPaths to jsonString(POSIX path of theItem)
	end repeat
	set previousDelimiters to AppleScript's text item delimiters
	set AppleScript's text item delimiters to ","
	set request to "{\"protocol\":${CLI_CONTROL_PROTOCOL},\"type\":\"open\",\"paths\":[" & (requestPaths as text) & "]}"
	set AppleScript's text item delimiters to previousDelimiters
	try
		set reply to do shell script "printf '%s\\n' " & quoted form of request & " | /usr/bin/nc -U " & quoted form of ${appleScriptString(endpoint)}
	on error
		return ${appleScriptString(DEV_NOT_RUNNING_MESSAGE)}
	end try
	if reply does not contain "\"ok\":true" then
		if reply is "" then return ${appleScriptString(DEV_NOT_RUNNING_MESSAGE)}
		return "npm run dev did not open the file: " & replyMessage(reply)
	end if
	if reply contains "\"status\":\"rejected\"" then return "npm run dev did not open the file: " & replyMessage(reply)
	return ""
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
`;
}

/** Advertises the packaged editor file types supported by the CLI, not template imports. */
export function createOpenerInfo(info) {
  const { CFBundleIconName: _assetCatalogIcon, ...rest } = info;
  return {
    ...rest,
    CFBundleIdentifier: OPENER_BUNDLE_ID,
    CFBundleName: OPENER_NAME,
    CFBundleDisplayName: OPENER_NAME,
    CFBundleIconFile: "droplet",
    CFBundleDocumentTypes: structuredClone(FILE_MODE_DOCUMENT_TYPES),
  };
}

export function openerPath(applicationsDirectory = path.join(os.homedir(), "Applications")) {
  return path.join(applicationsDirectory, `${OPENER_NAME}.app`);
}

export async function installOpener({ repoRoot, applicationsDirectory } = {}) {
  const target = openerPath(applicationsDirectory);
  await assertReplaceable(target);
  const endpoint = devControlEndpoint();
  const staging = await fs.mkdtemp(path.join(os.tmpdir(), "puppyone-open-with-"));
  try {
    const scriptPath = path.join(staging, "open-with.applescript");
    const staged = path.join(staging, path.basename(target));
    await fs.writeFile(scriptPath, createOpenerScript({ endpoint }));
    await run("/usr/bin/osacompile", ["-o", staged, scriptPath]);

    const infoPath = path.join(staged, "Contents/Info.plist");
    const info = plist.parse(await fs.readFile(infoPath, "utf8"));
    await fs.writeFile(infoPath, plist.build(createOpenerInfo(info)));
    const resources = path.join(staged, "Contents/Resources");
    await fs.rm(path.join(resources, "Assets.car"), { force: true });
    await buildMacosAppIcon({
      sourcePath: path.join(repoRoot, resolveDesktopAppIcon("dev").source),
      iconPath: path.join(resources, "droplet.icns"),
    });
    await run("/usr/bin/codesign", ["--force", "--sign", "-", staged]);

    await removeOpener({ applicationsDirectory });
    await fs.mkdir(path.dirname(target), { recursive: true });
    await run("/usr/bin/ditto", [staged, target]);
    await run(LSREGISTER, ["-f", target]);
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
  return target;
}

export async function removeOpener({ applicationsDirectory } = {}) {
  const target = openerPath(applicationsDirectory);
  if (!(await assertReplaceable(target))) return false;
  await run(LSREGISTER, ["-u", target]).catch(() => undefined);
  await fs.rm(target, { recursive: true, force: true });
  return true;
}

/** True when an earlier install exists. Refuses to touch anything else at that path. */
async function assertReplaceable(target) {
  let contents;
  try {
    contents = await fs.readFile(path.join(target, "Contents/Info.plist"), "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    try { await fs.lstat(target); } catch { return false; }
    throw new Error(`${target} exists but is not a dev Open With app; leaving it alone.`);
  }
  if (plist.parse(contents).CFBundleIdentifier !== OPENER_BUNDLE_ID) {
    throw new Error(`${target} belongs to another app; leaving it alone.`);
  }
  return true;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const command = process.argv[2] ?? "install";
  const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
  try {
    if (process.platform !== "darwin") throw new Error("The dev Open With app is macOS only.");
    if (command === "install") {
      const target = await installOpener({ repoRoot });
      console.log(`Installed ${target}`);
      console.log(`Right-click a Markdown, CSV or HTML file > Open With > ${OPENER_NAME}. Keep npm run dev running.`);
    } else if (command === "remove") {
      console.log((await removeOpener()) ? `Removed ${openerPath()}` : "Nothing to remove.");
    } else {
      throw new Error(`Unknown command: ${command}. Use install or remove.`);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
