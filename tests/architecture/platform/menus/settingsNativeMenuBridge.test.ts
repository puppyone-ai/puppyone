import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(new URL(`../../../../${path}`, import.meta.url), "utf8");

describe("native Settings menu bridge", () => {
  it("routes PuppyOne > Settings… to the focused window's Settings dialog", () => {
    const main = source("electron/main.mjs");
    const ipc = source("electron/main/ipc/settings-ipc.mjs");
    const preload = source("electron/preload.cjs");
    const app = source("src/App.tsx");

    expect(ipc).toContain('SETTINGS_OPEN_REQUESTED_CHANNEL = "settings:open-requested"');
    expect(main).toContain("window.webContents.send(SETTINGS_OPEN_REQUESTED_CHANNEL)");
    expect(preload).toContain('ipcRenderer.on("settings:open-requested"');
    expect(app).toContain("onSettingsRequested?.(() => openSettingsDialog())");
  });

  it("drops the sidebar footer bar only where the application menu states Settings", () => {
    const app = source("src/App.tsx");

    expect(app).toContain('const sidebarFooterVisible = useDesktopPlatformCapabilities()?.platform !== "macos";');
    expect(app).toContain("workspaceNavigationVisible={!railOwnsProject && sidebarFooterVisible}");
    expect(app).toContain("onOpenSettings={sidebarFooterVisible ? openSettingsDialog : undefined}");
    expect(app).toContain("utilitySlot={sidebarFooterVisible ? <DesktopHelpLauncher");
  });
});
