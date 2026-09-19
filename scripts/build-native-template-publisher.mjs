import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Windows directory rename already refuses an existing destination. POSIX
// needs an explicit no-replace primitive, not exists() followed by rename().
if (process.platform === "darwin" || process.platform === "linux") {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const { include_dir: includeDirectory } = createRequire(import.meta.url)("node-api-headers");
  const source = path.join(root, "local-api/templates/native/publish-directory.cc");
  const staging = mkdtempSync(path.join(path.dirname(source), ".build-"));
  const output = path.join(staging, "publish-directory.node");
  try {
    const mac = process.platform === "darwin";
    const args = mac
      ? ["clang++", "-std=c++17", "-bundle", "-undefined", "dynamic_lookup", "-arch", "arm64", "-arch", "x86_64", "-mmacosx-version-min=12.0"]
      : ["-std=c++17", "-shared", "-fPIC"];
    const result = spawnSync(mac ? "xcrun" : "c++", [...args, "-DNAPI_VERSION=8", "-I", includeDirectory, source, "-o", output], { stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Template publisher compilation failed (${result.status}).`);
    renameSync(output, source.replace(/\.cc$/, ".node"));
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
  console.log("Native template publisher built (Node-API 8).");
}
