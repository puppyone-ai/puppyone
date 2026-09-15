import path from "node:path";

export function getDefaultElectronBin(desktopRoot, platform = process.platform) {
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  return platform === "win32"
    ? pathApi.join(desktopRoot, "node_modules", "electron", "dist", "electron.exe")
    : pathApi.join(desktopRoot, "node_modules", ".bin", "electron");
}
