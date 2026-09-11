import { describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { resolveRuntimeAppImage, setDevelopmentDockIcon } from "../electron/main/app-icon.mjs";

describe("native app icon ownership", () => {
  it.each(["dev", "internal", "stable"])("leaves the packaged %s Dock icon to macOS", (channel) => {
    const app = { isPackaged: true, dock: { setIcon: vi.fn() } };
    setDevelopmentDockIcon({ app, supportsDockIcon: true, iconPath: `${channel}.png` });
    expect(app.dock.setIcon).not.toHaveBeenCalled();
  });

  it("uses the channel source directly for the unbundled runner", () => {
    const iconPath = resolveRuntimeAppImage({
      isPackaged: false,
      // A resource in Electron's own bundle must not override our development badge.
      resourcesPath: fileURLToPath(new URL("../assets/brand/puppy", import.meta.url)),
      projectRoot: fileURLToPath(new URL("..", import.meta.url)),
      channel: "dev",
    });
    expect(iconPath).toMatch(/puppy-app-image-dev\.png$/);
    const app = { isPackaged: false, dock: { setIcon: vi.fn() } };
    setDevelopmentDockIcon({ app, supportsDockIcon: true, iconPath });
    expect(app.dock.setIcon).toHaveBeenCalledExactlyOnceWith(iconPath);
  });

  it("does not use the development checkout to hide missing installed resources", () => {
    expect(resolveRuntimeAppImage({
      isPackaged: true, resourcesPath: "/missing-resources",
      projectRoot: fileURLToPath(new URL("..", import.meta.url)), channel: "stable",
    })).toBeNull();
  });

  it("does not call Dock APIs on other platforms", () => {
    const app = { isPackaged: false, dock: { setIcon: vi.fn() } };
    setDevelopmentDockIcon({ app, supportsDockIcon: false, iconPath: "icon.png" });
    expect(app.dock.setIcon).not.toHaveBeenCalled();
  });
});
