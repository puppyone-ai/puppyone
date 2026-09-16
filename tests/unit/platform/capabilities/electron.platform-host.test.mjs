import { describe, expect, it, vi } from "vitest";
import { registerPlatformIpcHandlers } from "../../../../electron/main/ipc/platform-ipc.mjs";
import { createDesktopPlatformHost } from "../../../../electron/main/platform/create-platform-host.mjs";
import { resolveDefaultDesktopShell } from "../../../../electron/main/platform/shell-policy.mjs";

describe("Desktop platform host", () => {
  it("composes macOS capabilities and native window behavior", async () => {
    const converter = vi.fn(async () => ({ bytes: Buffer.from("docx"), warnings: [] }));
    const host = createDesktopPlatformHost({
      nodePlatform: "darwin",
      nodeArch: "arm64",
      officeDocumentConverter: converter,
      safeStorage: { isEncryptionAvailable: () => true },
    });

    expect(host.target).toEqual({ id: "macos-arm64", platform: "macos", arch: "arm64" });
    expect(host.windowChrome.browserWindowOptions).toMatchObject({
      titleBarStyle: "hiddenInset",
      titleBarOverlay: true,
    });
    expect(host.getCapabilities()).toMatchObject({
      schemaVersion: 1,
      platform: "macos",
      primaryModifier: "meta",
      credentialStorage: { available: true, strength: "os-backed" },
      documentConversion: { supportedInputs: [".doc", ".rtf"] },
      updater: { supported: true, installMode: "squirrel" },
    });
    await expect(host.documents.convertOfficeDocumentToDocx("root", "file.rtf"))
      .resolves.toMatchObject({ warnings: [] });
    expect(converter).toHaveBeenCalledWith("root", "file.rtf");
  });

  it("fails closed when Linux safe storage falls back to basic text", async () => {
    const host = createDesktopPlatformHost({
      nodePlatform: "linux",
      nodeArch: "x64",
      safeStorage: {
        isEncryptionAvailable: () => true,
        getSelectedStorageBackend: () => "basic_text",
      },
    });
    expect(host.windowChrome.browserWindowOptions).toEqual({ titleBarStyle: "default" });
    expect(host.getCapabilities()).toMatchObject({
      platform: "linux",
      primaryModifier: "control",
      credentialStorage: {
        available: false,
        strength: "unavailable",
        backend: "basic_text",
      },
      documentConversion: { supportedInputs: [] },
      updater: { installMode: "appimage" },
    });
    await expect(host.documents.convertOfficeDocumentToDocx()).rejects.toThrow(/unavailable/i);
  });

  it("publishes one immutable capability snapshot through trusted IPC", () => {
    const handlers = new Map();
    const host = createDesktopPlatformHost({
      nodePlatform: "win32",
      nodeArch: "x64",
      safeStorage: { isEncryptionAvailable: () => true },
    });
    registerPlatformIpcHandlers({
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      platformHost: host,
    });
    expect(host.windowChrome.browserWindowOptions).toEqual({
      autoHideMenuBar: true,
      titleBarStyle: "hidden",
      titleBarOverlay: {
        color: "#00000000",
        symbolColor: "#1f1f1f",
        height: 38,
      },
    });
    expect(handlers.get("platform:get-capabilities")()).toBe(host.getCapabilities());
    expect(host.getCapabilities()).toMatchObject({
      platform: "windows",
      arch: "x64",
      windowChrome: { mode: "overlay" },
      updater: { installMode: "nsis" },
    });

    const ownerWindow = { setTitleBarOverlay: vi.fn() };
    host.windowChrome.synchronizeAppearance(ownerWindow, {
      background: "#fafafa",
      titlebarBackground: "rgb(7, 87, 215)",
    });
    expect(ownerWindow.setTitleBarOverlay).toHaveBeenCalledWith({
      color: "#00000000",
      symbolColor: "#f5f5f5",
      height: 38,
    });
  });
});

describe("Desktop shell policy", () => {
  it("uses platform-appropriate fallbacks without treating Linux as macOS", () => {
    expect(resolveDefaultDesktopShell({ platform: "darwin", environment: {} })).toBe("/bin/zsh");
    expect(resolveDefaultDesktopShell({ platform: "linux", environment: {} })).toBe("/bin/bash");
    expect(resolveDefaultDesktopShell({ platform: "win32", environment: {} })).toBe("cmd.exe");
    expect(resolveDefaultDesktopShell({
      platform: "linux",
      environment: { SHELL: "/usr/bin/fish" },
    })).toBe("/usr/bin/fish");
  });
});
