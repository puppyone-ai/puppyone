import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("pane-scoped external-open architecture", () => {
  it("keeps file-scoped actions out of the product Header", () => {
    const definition = source("src/features/app-shell/headerElements.tsx");
    const actions = source("src/features/app-shell/DesktopTitlebarActions.tsx");
    const app = source("src/App.tsx");
    const titlebarCss = source("src/styles/titlebar.css");
    const pane = source("src/features/editor-workbench/layout/EditorPaneShell.tsx");
    const paneMenu = source("src/features/editor-workbench/layout/EditorPaneActionsMenu.tsx");
    const updateButton = source("src/features/updates/DesktopUpdateTitlebarButton.tsx");

    expect(definition).not.toContain("external-open");
    expect(actions).not.toMatch(/editorFindCommand|csvViewSettings|activeFileExternalOpen/);
    expect(app).not.toMatch(/editorFindCommand|editorChromeContribution|activeExternalOpen/);
    expect(titlebarCss).not.toMatch(/desktop-titlebar-(?:external-open|csv-settings|editor-find)/);
    expect(pane).toContain("onOpenExternal");
    expect(paneMenu).toContain("findCommand.open");
    expect(paneMenu).toContain("menuContribution?.viewItems");
    expect(actions).toContain('definition.linkedRightSidebarToolId ? "right-sidebar"');
    expect(actions).toContain('className="desktop-titlebar-action-divider"');
    expect(titlebarCss).toMatch(
      /\.desktop-titlebar-action-divider\s*\{[^}]*height:\s*18px;[^}]*margin-inline:\s*3px;[^}]*background:\s*var\(--desktop-titlebar-divider\);[^}]*\}/s,
    );
    expect(actions).toContain("DesktopUpdateTitlebarButton");
    expect(actions.indexOf('group: "app-status"')).toBeLessThan(
      actions.indexOf("for (const definition"),
    );
    expect(updateButton).toContain("if (!presentation) return null");
    expect(updateButton).toContain("strokeWidth={2.3}");
    expect(updateButton).toContain('className="desktop-titlebar-update-label"');
    expect(updateButton).toContain('t("updates.action.download")');
    expect(titlebarCss).toMatch(
      /\.desktop-titlebar-update\s*\{[^}]*width:\s*auto;[^}]*padding:\s*0 6px;[^}]*border:\s*0;[^}]*border-radius:\s*var\(--desktop-toolbar-action-radius\);[^}]*background:\s*color-mix[^}]*\}/s,
    );
    expect(titlebarCss).toContain(".desktop-titlebar-update-label");
    expect(titlebarCss).not.toContain(".desktop-titlebar-update-dot");
  });

  it("delegates external file opening exclusively to the system default app", () => {
    const settings = source("src/features/settings/main/FileSettingsViews.tsx");
    const sidebar = source("src/features/settings/sidebar/settingsSidebarModel.ts");
    const target = source("src/features/external-apps/useExternalFileOpen.ts");
    const preferences = source("src/preferences.ts");
    const preferenceController = source("src/features/app-shell/useDesktopPreferences.ts");
    const preload = source("electron/preload.cjs");
    const ipc = source("electron/main/ipc/workspace-files-ipc.mjs");

    expect(settings).not.toContain("DefaultAppsSettingsView");
    expect(sidebar).not.toContain("external-apps");
    expect(preferences).not.toContain("ExternalAppsSettings");
    expect(preferenceController).toContain('localStorage.removeItem("puppyone.desktop.externalApps")');
    expect(target).toContain("openWorkspaceEntryExternal");
    expect(target).not.toMatch(/strategy|appPath|getAppName/);
    expect(preload).toContain("openEntryExternal:");
    expect(preload).not.toMatch(/resolveExternalOpenTarget|listExternalOpenTargets|chooseExternalApp/);
    expect(ipc).toContain("shell.openPath(targetPath)");
    expect(ipc).not.toMatch(/openFileWithExternalApplication|workspace:choose-external-app/);
  });
});

function source(relativePath: string) {
  return readFileSync(new URL(`../../../../${relativePath}`, import.meta.url), "utf8");
}
