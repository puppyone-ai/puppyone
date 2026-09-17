import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  configureDesktopTextRasterization,
  WINDOWS_GRAYSCALE_TEXT_SWITCH,
} from "../../../../electron/main/platform/text-rasterization-policy.mjs";

describe("desktop text rasterization policy", () => {
  it("is installed by the main process before Electron becomes ready", () => {
    const mainSource = readFileSync(
      new URL("../../../../electron/main.mjs", import.meta.url),
      "utf8",
    );
    const policyCall = mainSource.indexOf(
      "configureDesktopTextRasterization({ commandLine: app.commandLine });",
    );
    const readyBoundary = mainSource.indexOf("app.whenReady()");

    expect(policyCall).toBeGreaterThan(-1);
    expect(readyBoundary).toBeGreaterThan(policyCall);
  });

  it("selects one grayscale rendering path on Windows", () => {
    const commandLine = {
      appendSwitch: vi.fn(),
      hasSwitch: vi.fn(() => false),
    };

    expect(configureDesktopTextRasterization({
      commandLine,
      nodePlatform: "win32",
    })).toEqual({
      antialiasing: "grayscale",
      switch: WINDOWS_GRAYSCALE_TEXT_SWITCH,
    });
    expect(commandLine.hasSwitch).toHaveBeenCalledWith("disable-lcd-text");
    expect(commandLine.appendSwitch).toHaveBeenCalledWith("disable-lcd-text");
  });

  it("does not duplicate an explicit Windows switch", () => {
    const commandLine = {
      appendSwitch: vi.fn(),
      hasSwitch: vi.fn(() => true),
    };

    configureDesktopTextRasterization({ commandLine, nodePlatform: "win32" });

    expect(commandLine.appendSwitch).not.toHaveBeenCalled();
  });

  it.each(["darwin", "linux"])("preserves the %s platform default", (nodePlatform) => {
    const commandLine = { appendSwitch: vi.fn() };

    expect(configureDesktopTextRasterization({ commandLine, nodePlatform })).toEqual({
      antialiasing: "platform-default",
      switch: null,
    });
    expect(commandLine.appendSwitch).not.toHaveBeenCalled();
  });
});
