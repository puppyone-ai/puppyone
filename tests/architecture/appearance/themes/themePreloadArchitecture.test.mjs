import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const preload = readFileSync(new URL("../../../../electron/preload.cjs", import.meta.url), "utf8");
const main = readFileSync(new URL("../../../../electron/main.mjs", import.meta.url), "utf8");
const declarations = readFileSync(new URL("../../../../src/types/electron.d.ts", import.meta.url), "utf8");

describe("CSS theme host bridge architecture", () => {
  it("exposes only pathless catalog and directory commands", () => {
    expect(preload).toMatch(/themes:\s*\{[\s\S]*list:\s*\(\)\s*=>\s*ipcRenderer\.invoke\("theme:list"\)/);
    expect(preload).toMatch(/openDirectory:\s*\(\)\s*=>\s*ipcRenderer\.invoke\("theme:open-directory"\)/);
    expect(preload).toMatch(/create:\s*\(\)\s*=>\s*ipcRenderer\.invoke\("theme:create"\)/);
    expect(preload).not.toContain("theme:reload");
    expect(preload).not.toContain("theme:read-custom-css");
    expect(preload).not.toContain("theme:save-custom-css");
    expect(preload).not.toMatch(/themes:[\s\S]{0,400}(?:path|filePath|directoryPath)\s*=>/);
  });

  it("registers one host-owned service through trusted IPC", () => {
    expect(main).toContain('import { createThemeService } from "./main/themes/theme-service.mjs";');
    expect(main).toMatch(/import \{[\s\S]*registerThemeIpcHandlers,[\s\S]*\} from "\.\/main\/ipc\/theme-ipc\.mjs";/);
    expect(main).toMatch(/createThemeService\(\{[\s\S]*userDataPath:\s*app\.getPath\("userData"\)[\s\S]*shell/);
    expect(main).toMatch(/registerThemeIpcHandlers\(\{[\s\S]*ipcMain:\s*trustedIpcMain,[\s\S]*themeService/);
  });

  it("declares immutable renderer theme snapshots", () => {
    expect(declarations).toContain("type DesktopThemeTarget =");
    expect(declarations).toContain("type DesktopThemeSnapshot = Readonly<");
    expect(declarations).toMatch(/themes:\s*\{[\s\S]*list:\s*\(\)\s*=>\s*Promise<DesktopThemeSnapshot>/);
    expect(declarations).toMatch(/create:\s*\(\)\s*=>\s*Promise<\{\s*created:\s*true;\s*themeId:\s*string\s*\}>/);
  });
});
