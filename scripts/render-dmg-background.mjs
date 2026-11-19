#!/usr/bin/env node

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const installerAssets = path.join(repositoryRoot, "assets", "installer");
const sourcePath = path.join(installerAssets, "dmg-background.svg");
const oneXPath = path.join(installerAssets, "dmg-background.png");
const twoXPath = path.join(installerAssets, "dmg-background@2x.png");
const tiffPath = path.join(installerAssets, "dmg-background.tiff");
const width = 2048;
const height = 1280;
const scale = 2;
const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "puppyone-dmg-background-"));
const wrapperPath = path.join(temporaryRoot, "dmg-background-wrapper.svg");
const quickLookPath = `${wrapperPath}.png`;

try {
  const source = await fs.readFile(sourcePath);
  const encodedSource = source.toString("base64");
  const verticalInset = (width - height) / 2;
  const wrapper = `<?xml version="1.0" encoding="UTF-8"?>
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${width}" viewBox="0 0 ${width} ${width}">
      <rect width="${width}" height="${width}" fill="#fcfdfc"/>
      <image href="data:image/svg+xml;base64,${encodedSource}" x="0" y="${verticalInset}" width="${width}" height="${height}"/>
    </svg>`;
  await fs.writeFile(wrapperPath, wrapper);

  await execFileAsync("/usr/bin/qlmanage", [
    "-t",
    "-s",
    String(width * scale),
    "-o",
    temporaryRoot,
    wrapperPath,
  ]);
  await execFileAsync("/usr/bin/sips", [
    "--cropToHeightWidth",
    String(height * scale),
    String(width * scale),
    quickLookPath,
    "--out",
    twoXPath,
  ]);
  await execFileAsync("/usr/bin/sips", [
    "--resampleHeightWidth",
    String(height),
    String(width),
    twoXPath,
    "--out",
    oneXPath,
  ]);
  await execFileAsync("/usr/bin/tiffutil", [
    "-cathidpicheck",
    oneXPath,
    twoXPath,
    "-out",
    tiffPath,
  ]);

  console.log(`Rendered ${path.relative(repositoryRoot, tiffPath)} at ${width}x${height} (@1x and @2x).`);
} finally {
  await fs.rm(temporaryRoot, { force: true, recursive: true });
}
