#!/usr/bin/env node
/**
 * Puts `npm run dev` in the macOS Open With menu.
 *
 * macOS offers only installed apps that declare file types, and the dev build
 * runs inside a generic Electron.app that declares none. This installs a small
 * AppleScript app carrying the packaged build's declarations. Choosing it hands
 * the file to the running dev instance, so the File Mode window loads from the
 * Vite server and style edits apply live, without packaging.
 *
 * The app runs the Electron of the checkout it was installed from, and reaches
 * whichever dev instance is running. Reinstall after deleting that checkout.
 *
 *   npm run dev:open-with          install or refresh
 *   npm run dev:open-with:remove   uninstall
 */
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import plist from "plist";
import { createDesktopLaunchIntent } from "../../../electron/main/desktop-launch-intent.mjs";
import { resolveDesktopAppIcon } from "../../../shared/desktop/app-icon-contract.mjs";
import { buildMacosAppIcon } from "../build/macos-app-icon.mjs";
import { FILE_MODE_DOCUMENT_TYPES } from "../build/platforms/macos.mjs";

export const OPENER_NAME = "PuppyOne (npm run dev)";
export const OPENER_BUNDLE_ID = "ai.puppyone.desktop.dev-open-with";

/** How the forwarder reports back to the Open With app. */
export const FORWARD_EXIT = Object.freeze({ delivered: 0, noFile: 2, devNotRunning: 3 });

const LSREGISTER = "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";
const run = promisify(execFile);

/**
 * Hands the file named on the command line to whichever instance holds the
 * lock for `userDataPath`, exactly like a second launch of the real app.
 */
export function forwardFile({ app, argv, workingDirectory, userDataPath }) {
  const intent = createDesktopLaunchIntent({ argv, workingDirectory });
  if (!intent.filePath) return FORWARD_EXIT.noFile;
  app.setPath("userData", userDataPath);
  if (!app.requestSingleInstanceLock(intent)) return FORWARD_EXIT.delivered;
  // Getting the lock means nothing is running to receive the file.
  app.releaseSingleInstanceLock();
  return FORWARD_EXIT.devNotRunning;
}

export function appleScriptString(value) {
  return `"${String(value).replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")}"`;
}

/**
 * The Open With app. It waits for each hand-off so a missing dev instance is
 * reported instead of silently starting a second, unrelated app.
 */
export function createOpenerScript({ electronPath, forwarderPath }) {
  const command = `quoted form of ${appleScriptString(electronPath)} & " " & quoted form of ${appleScriptString(forwarderPath)}`;
  return `on open theItems
	repeat with theItem in theItems
		try
			do shell script ${command} & " " & quoted form of (POSIX path of theItem) & " >/dev/null 2>&1"
		on error errorMessage number errorNumber
			activate
			if errorNumber is ${FORWARD_EXIT.devNotRunning} then
				display dialog "PuppyOne is not running from npm run dev. Start it, then open the file again." buttons {"OK"} default button 1 with icon caution
			else
				display dialog "The file could not be handed to npm run dev (" & errorNumber & ")." buttons {"OK"} default button 1 with icon caution
			end if
			return
		end try
	end repeat
end open

on run
	activate
	display dialog "Choose ${OPENER_NAME} from a file's Open With menu. The file opens in the running npm run dev instance." buttons {"OK"} default button 1
end run
`;
}

/** Replaces the droplet's accept-everything declaration with the packaged build's. */
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
  const electronPath = createRequire(path.join(repoRoot, "package.json"))("electron");
  const forwarderPath = path.join(repoRoot, "scripts/desktop/dev/open-with-forwarder.mjs");
  const staging = await fs.mkdtemp(path.join(os.tmpdir(), "puppyone-open-with-"));
  try {
    const scriptPath = path.join(staging, "open-with.applescript");
    const staged = path.join(staging, path.basename(target));
    await fs.writeFile(scriptPath, createOpenerScript({ electronPath, forwarderPath }));
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
