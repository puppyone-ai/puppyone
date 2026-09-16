#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertDesktopBuildInfo } from "../shared/desktop-build-identity.mjs";
import { verifyPackagedDesktopBuild } from "./release-support/packaged-desktop-build-verifier.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

try {
  const args = parseArguments(process.argv.slice(2));
  const buildInfoPath = path.resolve(
    repositoryRoot,
    args.buildInfo ?? "generated/desktop-build-info.json",
  );
  const buildInfo = assertDesktopBuildInfo(JSON.parse(await fs.readFile(buildInfoPath, "utf8")));
  const result = await verifyPackagedDesktopBuild({
    releaseDirectory: path.resolve(repositoryRoot, args.releaseDirectory ?? "release"),
    buildInfo,
    target: args.target ?? "macos-arm64",
  });
  console.log(
    `Verified ${result.applications.length} packaged app(s) for ${args.target ?? "macos-arm64"} against ${buildInfo.channel} ${buildInfo.version}.`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

function parseArguments(values) {
  const options = {};
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (!key?.startsWith("--") || value == null) {
      throw new Error(`Invalid packaged-build verifier argument near ${key ?? "end of input"}.`);
    }
    if (key === "--build-info") options.buildInfo = value;
    else if (key === "--release-directory") options.releaseDirectory = value;
    else if (key === "--target") options.target = value;
    else throw new Error(`Unknown option: ${key}`);
  }
  return options;
}
