import { describe, expect, it, vi } from "vitest";
import {
  createNativeUpdateMenuAction,
  createUpdateCheckPresentation,
} from "../../../../electron/main/native-update-menu-action.mjs";

const messages = {
  "native.update.manual.ok": "OK",
  "native.update.manual.notNow": "Not Now",
  "native.update.manual.updateNow": "Update Now",
  "native.update.manual.restart": "Restart and Update",
  "native.update.manual.unknownVersion": "unknown",
  "native.update.manual.current.title": "No Updates Available",
  "native.update.manual.current.message": "{appName} is up to date.",
  "native.update.manual.current.detail": "Version {version} is the latest version.",
  "native.update.manual.available.title": "Update Available",
  "native.update.manual.available.message": "{appName} {version} is available.",
  "native.update.manual.available.detail": "You are currently using version {currentVersion}.",
  "native.update.manual.ready.title": "Update Ready",
  "native.update.manual.ready.message": "{appName} {version} is ready to install.",
  "native.update.manual.ready.detail": "Restart the app to finish installing the update.",
  "native.update.manual.unavailable.title": "Updates Unavailable",
  "native.update.manual.unavailable.message": "{appName} cannot check for updates in this build.",
  "native.update.manual.unavailable.detail": "Update checking is available in signed release builds.",
  "native.update.manual.failed.title": "Unable to Check for Updates",
  "native.update.manual.failed.message": "{appName} could not check for updates.",
  "native.update.manual.failed.detail": "Try again later.",
};

function t(messageId, values = {}) {
  return Object.entries(values).reduce(
    (value, [key, replacement]) => value.replaceAll(`{${key}}`, String(replacement)),
    messages[messageId] ?? messageId,
  );
}

describe("native update menu action", () => {
  it("reports an up-to-date release without starting an update", async () => {
    const owner = { id: "window" };
    const dialog = { showMessageBox: vi.fn(async () => ({ response: 0 })) };
    const updateService = {
      checkForUpdates: vi.fn(async () => ({
        status: "not-available",
        channel: "stable",
        currentVersion: "1.4.0",
      })),
      updateNow: vi.fn(),
    };
    const action = createNativeUpdateMenuAction({
      appName: "puppyone",
      dialog,
      getOwnerWindow: () => owner,
      getUpdateService: () => updateService,
      t,
    });

    await action();

    expect(dialog.showMessageBox).toHaveBeenCalledWith(owner, expect.objectContaining({
      message: "puppyone is up to date.",
      detail: "Version 1.4.0 is the latest version.",
    }));
    expect(updateService.updateNow).not.toHaveBeenCalled();
  });

  it.each([
    "available",
    "downloading",
    "downloaded",
    "blocked",
    "installing",
  ])("keeps the native check quiet while an update is %s", async (status) => {
    const dialog = { showMessageBox: vi.fn(async () => ({ response: 0 })) };
    const updateService = {
      checkForUpdates: vi.fn(async () => ({
        status,
        channel: "stable",
        currentVersion: "1.4.0",
        availableVersion: "1.5.0",
      })),
      updateNow: vi.fn(async () => ({ status: "installing" })),
    };
    const action = createNativeUpdateMenuAction({
      appName: "puppyone",
      dialog,
      getOwnerWindow: () => null,
      getUpdateService: () => updateService,
      t,
    });

    await action();

    expect(dialog.showMessageBox).not.toHaveBeenCalled();
    expect(updateService.updateNow).not.toHaveBeenCalled();
  });

  it("never offers an update action for an older candidate", () => {
    const presentation = createUpdateCheckPresentation({
      appName: "puppyone",
      state: {
        status: "available",
        channel: "stable",
        currentVersion: "1.4.0",
        availableVersion: "1.3.9",
      },
      t,
    });

    expect(presentation.updateAction).toBeNull();
    expect(presentation.options).toMatchObject({
      title: "No Updates Available",
      message: "puppyone is up to date.",
    });
  });

  it("keeps disabled builds honest instead of running a dead command", async () => {
    const presentation = createUpdateCheckPresentation({
      appName: "PuppyOne Development",
      state: { status: "disabled" },
      t,
    });

    expect(presentation.updateAction).toBeNull();
    expect(presentation.options).toMatchObject({
      title: "Updates Unavailable",
      message: "PuppyOne Development cannot check for updates in this build.",
      buttons: ["OK"],
    });
  });
});
