import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform === "darwin") {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const { include_dir: includeDirectory } = createRequire(import.meta.url)("node-api-headers");
  const source = path.join(root, "electron/main/platform/macos/native/resource-drag.mm");
  const staging = mkdtempSync(path.join(path.dirname(source), ".build-"));
  const output = path.join(staging, "resource-drag.node");
  // A universal Node-API module can ship in either macOS architecture artifact.
  try {
    const result = spawnSync("xcrun", ["clang++", "-std=c++17", "-fobjc-arc", "-bundle", "-undefined", "dynamic_lookup",
      "-DNAPI_VERSION=8", "-arch", "arm64", "-arch", "x86_64", "-mmacosx-version-min=12.0",
      "-framework", "AppKit", "-I", includeDirectory, source, "-o", output], { stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Native drag compilation failed (${result.status}).`);
    // Never truncate a binary that a running Development app may have mapped.
    renameSync(output, source.replace(/\.mm$/, ".node"));
  } finally { rmSync(staging, { recursive: true, force: true }); }
  console.log("Native resource drag module built (macOS universal, Node-API 8).");
}
