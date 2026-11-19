import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import plist from "plist";
import {
  APP_IMAGE_RESOURCE_FILENAME,
  MACOS_APP_ICON_FILENAME,
  resolveDesktopAppIcon,
} from "../../../shared/desktop/app-icon-contract.mjs";
import { decodeAppIconPng } from "./app-icon-validation.mjs";

const run = promisify(execFile);
const representations = [16, 32, 128, 256, 512].flatMap((size) => [1, 2].map((scale) => ({
  filename: `icon_${size}x${size}${scale === 2 ? "@2x" : ""}.png`,
  pixels: size * scale,
})));

export function resolveMacosIconBuildInputs(projectDir, config) {
  const entries = config.extraResources?.filter((entry) => entry?.to === APP_IMAGE_RESOURCE_FILENAME);
  const icon = ["dev", "internal", "stable"]
    .map(resolveDesktopAppIcon)
    .find((candidate) => candidate.macos === config.mac?.icon);
  if (!icon || entries?.length !== 1 || entries[0].from !== icon.source) {
    throw new Error("macOS icon configuration must use the channel's canonical PNG and generated ICNS.");
  }
  return { sourcePath: path.join(projectDir, icon.source), iconPath: path.join(projectDir, icon.macos) };
}

export async function buildMacosAppIcon({ sourcePath, iconPath }) {
  const source = await fs.readFile(sourcePath);
  decodeAppIconPng(source, 1024, sourcePath);
  await fs.mkdir(path.dirname(iconPath), { recursive: true });
  const staging = await fs.mkdtemp(path.join(path.dirname(iconPath), ".prepare-"));
  try {
    const iconset = path.join(staging, "app.iconset");
    await fs.mkdir(iconset);
    // Use one immutable snapshot even if the authored asset changes during a build.
    const snapshot = path.join(staging, "source.png");
    await fs.writeFile(snapshot, source);
    for (const { filename, pixels } of representations) {
      const output = path.join(iconset, filename);
      if (pixels === 1024) await fs.copyFile(snapshot, output);
      else await run("/usr/bin/sips", ["-z", String(pixels), String(pixels), snapshot, "--out", output]);
    }
    const generated = path.join(staging, MACOS_APP_ICON_FILENAME);
    // The pinned builder converter mislabels Retina sizes. Supply its supported
    // prebuilt ICNS input, produced by Apple's native iconset toolchain instead.
    await run("/usr/bin/iconutil", ["-c", "icns", iconset, "-o", generated]);
    await verifyMacosIcns(generated, source);
    await fs.rename(generated, iconPath);
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}

export async function verifyMacosIcns(iconPath, source) {
  const original = decodeAppIconPng(source, 1024, "App Image");
  const contents = await fs.readFile(iconPath);
  if (contents.length < 8 || contents.toString("ascii", 0, 4) !== "icns"
    || contents.readUInt32BE(4) !== contents.length) {
    throw new Error(`${iconPath} is not a valid ICNS container.`);
  }
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "puppyone-verify-icon-"));
  try {
    const iconset = path.join(temporary, "decoded.iconset");
    // Decode with the OS tool, including Apple's compressed ARGB small icons.
    await run("/usr/bin/iconutil", ["-c", "iconset", iconPath, "-o", iconset]);
    for (const { filename, pixels } of representations) {
      const image = decodeAppIconPng(await fs.readFile(path.join(iconset, filename)), pixels, filename);
      if (pixels === 1024 && !image.data.equals(original.data)) {
        throw new Error("ICNS artwork does not match the canonical App Image.");
      }
    }
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}

export async function verifyMacosAppIcon(applicationPath, expected = {}) {
  const contents = path.join(applicationPath, "Contents");
  const resources = path.join(contents, "Resources");
  const info = plist.parse(await fs.readFile(path.join(contents, "Info.plist"), "utf8"));
  if (info.CFBundleIconFile !== MACOS_APP_ICON_FILENAME || info.CFBundleIconName != null) {
    throw new Error(`CFBundleIconFile must be ${MACOS_APP_ICON_FILENAME}, without CFBundleIconName.`);
  }
  const source = await fs.readFile(path.join(resources, APP_IMAGE_RESOURCE_FILENAME));
  if (expected.sourcePath && !source.equals(await fs.readFile(expected.sourcePath))) {
    throw new Error("Packaged App Image differs from the selected channel's source.");
  }
  const iconPath = path.join(resources, MACOS_APP_ICON_FILENAME);
  if (expected.iconPath && !(await fs.readFile(iconPath)).equals(await fs.readFile(expected.iconPath))) {
    throw new Error("Packaged ICNS differs from the generated channel icon.");
  }
  await verifyMacosIcns(iconPath, source);
}
