import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Every macOS window module: resource drag, and title bar scrolling.
const MODULES = ["resource-drag", "title-bar-scroll"];

if (process.platform === "darwin") {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const { include_dir: includeDirectory } = createRequire(import.meta.url)("node-api-headers");
  for (const name of MODULES) {
    const source = path.join(root, `electron/main/platform/macos/native/${name}.mm`);
    const staging = mkdtempSync(path.join(path.dirname(source), ".build-"));
    const output = path.join(staging, `${name}.node`);
    // A universal Node-API module can ship in either macOS architecture artifact.
    try {
      const result = spawnSync("xcrun", ["clang++", "-std=c++17", "-fobjc-arc", "-bundle", "-undefined", "dynamic_lookup",
        "-DNAPI_VERSION=8", "-arch", "arm64", "-arch", "x86_64", "-mmacosx-version-min=12.0",
        "-framework", "AppKit", "-I", includeDirectory, source, "-o", output], { stdio: "inherit" });
      if (result.error) throw result.error;
      if (result.status !== 0) throw new Error(`Native ${name} compilation failed (${result.status}).`);
      // Never truncate a binary that a running Development app may have mapped.
      renameSync(output, source.replace(/\.mm$/, ".node"));
    } finally { rmSync(staging, { recursive: true, force: true }); }
  }
  console.log(`Native macOS window modules built: ${MODULES.join(", ")} (macOS universal, Node-API 8).`);
}
