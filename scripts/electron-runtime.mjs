import path from "node:path";

export function getDefaultElectronBin(desktopRoot) {
  return process.platform === "win32"
    ? path.join(desktopRoot, "node_modules", ".bin", "electron.cmd")
    : path.join(desktopRoot, "node_modules", ".bin", "electron");
}
