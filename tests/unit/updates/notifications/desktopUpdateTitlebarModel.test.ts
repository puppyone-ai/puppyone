import { describe, expect, it } from "vitest";
import { getDesktopUpdateTitlebarState } from "../../../../src/features/updates";
import type { DesktopUpdateState, DesktopUpdateStatus } from "../../../../src/types/electron";

describe("desktop update titlebar presentation", () => {
  it("stays hidden when the app shell does not provide updater capability", () => {
    expect(getDesktopUpdateTitlebarState(undefined)).toBeNull();
    expect(getDesktopUpdateTitlebarState(null)).toBeNull();
  });

  it.each<DesktopUpdateStatus>([
    "disabled",
    "idle",
    "checking",
    "not-available",
    "error",
  ])("stays hidden for %s", (status) => {
    expect(getDesktopUpdateTitlebarState(createState(status))).toBeNull();
  });

  it("appears only after an update is confirmed and follows its actionable lifecycle", () => {
    expect(getDesktopUpdateTitlebarState(createState("available"))).toMatchObject({
      kind: "available",
      interactive: true,
      version: "1.5.0",
    });
    expect(getDesktopUpdateTitlebarState(createState("downloading", 37.4))).toMatchObject({
      kind: "downloading",
      interactive: false,
      progressPercent: 37,
    });
    expect(getDesktopUpdateTitlebarState(createState("downloaded"))).toMatchObject({
      kind: "ready",
      interactive: true,
    });
    expect(getDesktopUpdateTitlebarState(createState("blocked"))).toMatchObject({
      kind: "ready",
      interactive: true,
    });
    expect(getDesktopUpdateTitlebarState(createState("installing"))).toMatchObject({
      kind: "installing",
      interactive: false,
    });
  });

  it.each([
    ["1.4.0", "same"],
    ["1.3.9", "older"],
    ["1.5.0-internal.1", "cross-channel"],
  ])("fails closed and stays hidden for a %s candidate (%s)", (availableVersion) => {
    expect(getDesktopUpdateTitlebarState({
      ...createState("available"),
      availableVersion,
    })).toBeNull();
  });
});

function createState(status: DesktopUpdateStatus, percent = 0): DesktopUpdateState {
  return {
    status,
    currentVersion: "1.4.0",
    channel: "stable",
    availableVersion: "1.5.0",
    updateInfo: null,
    progress: status === "downloading"
      ? { percent, bytesPerSecond: 0, transferred: 0, total: 0 }
      : null,
    blockers: [],
    error: status === "error" ? "offline" : null,
    reason: null,
    lastCheckedAt: null,
    updatedAt: "2026-08-13T00:00:00.000Z",
  };
}
