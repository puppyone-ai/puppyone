import path from "node:path";
import { describe, expect, it } from "vitest";
import { getDefaultElectronBin } from "../../../../scripts/electron-runtime.mjs";

describe("Electron development runtime", () => {
  it("launches the real executable instead of a command shim on Windows", () => {
    const desktopRoot = "C:\\workspace\\puppyone-desktop";

    expect(getDefaultElectronBin(desktopRoot, "win32")).toBe(path.win32.join(
      desktopRoot,
      "node_modules",
      "electron",
      "dist",
      "electron.exe",
    ));
  });

  it("uses the package binary on Unix platforms", () => {
    const desktopRoot = "/workspace/puppyone-desktop";

    expect(getDefaultElectronBin(desktopRoot, "darwin")).toBe(path.posix.join(
      desktopRoot,
      "node_modules",
      ".bin",
      "electron",
    ));
  });
});
