#!/usr/bin/env node

import {
  assertDesktopTargetManifest,
  createDesktopCiMatrix,
} from "./desktop/targets/target-manifest.mjs";

const scopeArgument = readArgument("--scope") ?? "contracts";
const channel = readArgument("--channel");

try {
  assertDesktopTargetManifest();
  process.stdout.write(`${JSON.stringify(createDesktopCiMatrix({
    scope: scopeArgument,
    channel,
  }))}\n`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

function readArgument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}
