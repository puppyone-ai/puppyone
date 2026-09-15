import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("desktop window navigation security", () => {
  it("keeps the Electron shell opener private to the external navigation service", () => {
    const electronRoot = fileURLToPath(new URL("../../../../electron", import.meta.url));
    const authorityPath = path.join(electronRoot, "main", "external-navigation-service.mjs");
    const bypasses = listJavaScriptFiles(electronRoot)
      .filter((filePath) => filePath !== authorityPath)
      .flatMap((filePath) => fs.readFileSync(filePath, "utf8")
        .split("\n")
        .map((line, index) => ({ filePath, line, lineNumber: index + 1 })))
      .filter(({ line }) => /\bshell\.openExternal\s*\(/.test(line))
      .map(({ filePath, lineNumber }) => `${path.relative(electronRoot, filePath)}:${lineNumber}`);

    expect(bypasses).toEqual([]);
  });

});

function listJavaScriptFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return listJavaScriptFiles(entryPath);
    return /\.(?:cjs|mjs)$/.test(entry.name) ? [entryPath] : [];
  });
}
