import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Desktop update interaction boundaries", () => {
  it("keeps blocked updates in Settings and never rechecks a downloaded payload", () => {
    const service = source("electron/update-service.mjs");
    const main = source("electron/main.mjs");
    const settingsRow = source("src/features/updates/DesktopUpdateSettingsRow.tsx");
    const titlebarButton = source("src/features/updates/DesktopUpdateTitlebarButton.tsx");
    const updateModel = source("src/features/updates/updateModel.ts");
    const updatePreview = source("src/features/updates/updatePreview.ts");
    const updateController = source("src/features/updates/useDesktopUpdates.ts");
    const titlebarActions = source("src/features/app-shell/DesktopTitlebarActions.tsx");

    expect(service).toContain('state.status === "downloaded" || state.status === "blocked"');
    expect(service).not.toContain('|| status === "blocked";');
    expect(service).toContain("confirmRestartWithBlockers");
    expect(service).toContain("allowDowngrade: false");
    expect(service).toContain("autoUpdater.allowDowngrade = configuration.allowDowngrade");
    expect(service).toContain("evaluateDesktopUpdateCandidate");
    expect(main).toContain(
      "confirmRestartWithBlockers: confirmUpdateRestartWithBlockers",
    );
    expect(main).toContain("native.update.confirm.proceed");
    expect(settingsRow).toContain('<span>{t("updates.settings.title")}</span>');
    expect(settingsRow).toContain('aria-label={`${action.label}. ${detail}`}');
    expect(settingsRow).not.toContain("desktop-settings-label-stack");
    expect(settingsRow).not.toContain("<small");
    expect(settingsRow).toContain(
      'state.status === "downloaded" || state.status === "blocked"',
    );
    expect(settingsRow).toContain('state.status === "not-available"');
    expect(settingsRow).toContain('t("updates.action.upToDate")');
    expect(settingsRow).toContain('state.channel === "dev" ? "updates.action.developmentBuild"');
    expect(service).toContain("BACKGROUND_UPDATE_INITIAL_DELAY_MS");
    expect(service).toContain("BACKGROUND_UPDATE_INTERVAL_MS");
    expect(service).toContain("scheduleBackgroundCheck");
    expect(titlebarActions).toContain('group: "app-status"');
    expect(titlebarActions).toContain("<DesktopUpdateTitlebarButton");
    expect(titlebarButton).toContain("getDesktopUpdateTitlebarState(state)");
    expect(updateModel).toContain('state.status === "available"');
    expect(updateModel).toContain('state.status === "downloading"');
    expect(updateModel).toContain('state.status === "downloaded" || state.status === "blocked"');
    expect(updateModel).not.toMatch(/status === "(?:disabled|idle|checking|not-available|error)"/);
    expect(updatePreview).toContain("if (!isDevelopment");
    expect(updateController).toContain("isDevelopment: import.meta.env.DEV");
  });
});

function source(relativePath: string) {
  return readFileSync(new URL(`../../../../${relativePath}`, import.meta.url), "utf8");
}
