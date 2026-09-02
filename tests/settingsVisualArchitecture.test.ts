import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("settings visual architecture", () => {
  it("keeps General app-scoped and moves project identity into Local Project", () => {
    const view = source("src/features/settings/SettingsView.tsx");
    const app = source("src/App.tsx");
    const sidebarModel = source("src/features/settings/sidebar/settingsSidebarModel.ts");
    const types = source("src/features/settings/types.ts");
    const general = source("src/features/settings/main/GeneralSettingsView.tsx");
    const localAgents = source("src/features/local-agents/ui/LocalAgentsSettingsView.tsx");
    const localAgentHooks = source("src/features/local-agents/ui/LocalAgentHooksSettingsView.tsx");
    const localProject = source("src/features/settings/main/LocalProjectSettingsView.tsx");
    const privacy = source("src/features/settings/main/PrivacySettingsView.tsx");
    const language = source("src/features/settings/LanguageSetting.tsx");

    expect(types).toContain('"general" | "privacy" | "local-project"');
    expect(types).toContain('"appearance" | "local-agents" | "editor" | "new-menu"');
    expect(types).toContain('| "editor"');
    expect(types).not.toContain('"external-apps"');
    expect(types).not.toContain('"local-agent-hooks"');
    expect(types).not.toContain('| "language"');
    expect(types).not.toContain('"workspace"');
    expect(view).toContain('if (activeSection === "general")');
    expect(view).toContain('if (activeSection === "privacy")');
    expect(view).toContain('if (activeSection === "local-agents")');
    expect(view).not.toContain('if (activeSection === "local-agent-hooks")');
    expect(view).toContain('if (activeSection === "local-project")');
    expect(view).not.toContain('activeSection === "language"');
    expect(general).toContain("<LanguageSettingRow />");
    expect(general).not.toContain("ProductAnalyticsSettingsRow");
    expect(privacy).toContain("<ProductAnalyticsSettingsRow />");
    expect(privacy).not.toContain("SettingsSubsection");
    expect(privacy).not.toContain("collectionDetails");
    expect(general).toContain("<DesktopBuildVersionSettingsRow />");
    expect(general).toContain("<DesktopUpdateSettingsRow");
    expect(general).not.toContain("Workspace");
    expect(general).not.toContain("onUnlinkWorkspace");
    expect(general).not.toContain("AgentActivity");
    expect(general).not.toContain("localAgents");
    expect(localAgents).toContain('settings.localAgents.title');
    expect(localAgents).toContain('detail={t("settings.localAgents.detail")}');
    expect(localAgents).toContain("useTerminalAgentLocator");
    expect(localAgents).toContain("DESKTOP_TERMINAL_LAUNCHERS");
    expect(localAgents).toContain("<TerminalLauncherIcon");
    expect(localAgents).toContain("desktop-settings-switch");
    expect(localAgents).toContain("setTerminalAgentVisible");
    expect(localAgents).toContain("<LocalAgentHooksSettingsSection");
    expect(localAgentHooks).toContain("getAgentActivityEnrollment");
    expect(localAgentHooks).toContain("setAgentActivityEnrollment");
    expect(localAgentHooks).toContain("selectableProviders.map");
    expect(localAgentHooks).toContain("provider.configurable");
    expect(localAgentHooks).toContain("<TerminalLauncherIcon");
    expect(localAgents).toContain("settings.localAgents.activeChat.title");
    expect(localAgents).toContain("desktop-local-agent-settings-layout");
    expect(localAgents).toContain("desktop-local-agent-group-title");
    expect(localAgents).toContain("desktop-local-agent-settings-table");
    expect(localAgentHooks).toContain("desktop-local-agent-group-title");
    expect(localAgentHooks).toContain("desktop-local-agent-settings-table");
    expect(localAgentHooks).not.toContain("<details");
    expect(localAgentHooks).not.toContain("<SettingsSectionHeader");
    expect(localAgentHooks).not.toContain("<small>{status}</small>");
    expect(localAgents).not.toContain("settings.localAgents.visible");
    expect(localAgents).not.toContain("settings.localAgents.hidden");
    expect(view).not.toContain("<LocalAgentHooksSettingsView");
    expect(localAgentHooks).not.toContain("desktop-utility-view");
    expect(view).not.toContain("<AgentFileActivityAppearanceSetting");
    expect(app).not.toContain("enabledRuntimeIds={enabledAgentRuntimeIds}");
    expect(app).toContain("hiddenRuntimeIds={agentChatRuntimeVisibility.hiddenRuntimeIds}");
    expect(localProject).toContain("settings.localProject.path");
    expect(localProject).toContain("onUnlinkWorkspace");
    expect(localProject).not.toContain("DesktopBuildVersionSettingsRow");
    expect(localProject).not.toContain("LanguageSettingRow");

    const desktopAppItems = sidebarModel.slice(
      sidebarModel.indexOf('id: "desktop-app"'),
      sidebarModel.indexOf('\n  {\n    id: "local-project"', sidebarModel.indexOf('id: "desktop-app"') + 1),
    );
    expectInOrder(desktopAppItems, [
      'labelId: "settings.sidebar.general"',
      'labelId: "settings.sidebar.appearance"',
      'labelId: "settings.sidebar.localAgents"',
      'labelId: "settings.sidebar.createNew"',
      'labelId: "settings.sidebar.editor"',
      'labelId: "settings.sidebar.privacy"',
      'labelId: "settings.sidebar.experimental"',
    ]);
    expect(desktopAppItems).toContain("settings.sidebar.editor");
    expect(desktopAppItems).not.toContain("settings.sidebar.language");
    expect(desktopAppItems).not.toContain("settings.sidebar.localAgentHooks");
    expect(sidebarModel).toContain('labelId: "settings.sidebar.localProject"');
    expect(sidebarModel).toContain('labelId: "settings.sidebar.projectInfo"');

    expect(language).toContain("desktop-settings-select desktop-language-setting-select");
    expect(language).toContain("void changeLanguage(nextPreference)");
    expect(language).not.toContain("<SettingsSectionHeader");
    expect(language).not.toContain("<button");
  });

  it("exposes Editor typography without Markdown presentation overrides", () => {
    const sidebarModel = source("src/features/settings/sidebar/settingsSidebarModel.ts");
    const settingsView = source("src/features/settings/SettingsView.tsx");
    const editorSettings = source("src/features/settings/main/EditorSettingsView.tsx");
    const preferences = source("src/preferences.ts");
    const loading = source("src/components/loading/index.tsx");
    const app = source("src/App.tsx");
    const reviewRuntime = source("src/features/data-workspace/useAiEditReviewRequest.ts");
    const reviewEngine = source("local-api/edit-review.mjs");

    expect(sidebarModel).toContain('id: "editor"');
    expect(settingsView).toContain("<EditorSettingsView");
    expect(settingsView).toContain('import("./main/EditorSettingsView")');
    expect(settingsView).not.toContain("ContentFontSetting");
    expect(settingsView).not.toContain("settings.appearance.textSize");
    expect(editorSettings).toContain("settings.editor.typography");
    expect(editorSettings).toContain("MarkdownFontSetting");
    expect(editorSettings).not.toContain("markdownPresentation");
    expect(editorSettings).not.toContain("<MarkdownPresentationPreview");
    expect(editorSettings).not.toContain("markdownPresentation.headingScale");
    expect(editorSettings).not.toContain("aiEditAssistEnabled");
    expect(editorSettings).not.toContain("diffMarkers");
    expect(settingsView).not.toContain("onAiEditAssistEnabledChange");
    expect(settingsView).not.toContain("onDiffMarkersChange");
    expect(preferences).toContain("AI_EDIT_ASSIST_STORAGE_KEY");
    expect(preferences).toContain("DIFF_MARKERS_STORAGE_KEY");
    expect(app).toContain("useAiEditReviewRequest");
    expect(app).toContain("diffMarkers,");
    expect(app).toContain("{...surfaceAppearance.rootProps}");
    expect(reviewRuntime).toContain("subscribeAiEditReviewUpdates");
    expect(reviewEngine).toContain("flushWorkspaceEditReviewChanges");
  });

  it("keeps every supported locale complete for General and Local Project", () => {
    const manifest = JSON.parse(source("locales/manifest.json")) as {
      locales: Array<{ locale: string }>;
    };

    for (const { locale } of manifest.locales) {
      const catalog = JSON.parse(source(`locales/renderer/${locale}/settings.json`)) as Record<string, string>;
      expect(catalog["sidebar.language"], locale).toBeUndefined();
      expect(catalog["sidebar.localProject"], locale).toBeTruthy();
      expect(catalog["sidebar.privacy"], locale).toBeTruthy();
      expect(catalog["sidebar.projectInfo"], locale).toBeTruthy();
      expect(catalog["sidebar.localAgents"], locale).toBeTruthy();
      expect(catalog["sidebar.createNew"], locale).toBeTruthy();
      expect(catalog["sidebar.defaultApps"], locale).toBeUndefined();
      expect(catalog["sidebar.localAgentHooks"], locale).toBeUndefined();
      expect(catalog["general.title"], locale).toBeTruthy();
      expect(catalog["general.detail"], locale).toBeTruthy();
      for (const key of [
        "title",
        "detail",
        "productAnalyze.title",
        "productAnalyze.detail",
        "productAnalyze.error",
        "productAnalyze.learnMore",
      ]) {
        expect(catalog[`privacy.${key}`], `${locale}: settings.privacy.${key}`).toBeTruthy();
      }
      expect(catalog["localAgents.title"], locale).toBeTruthy();
      expect(catalog["localAgents.detail"], locale).toBeTruthy();
      expect(catalog["localAgents.activeChat.title"], locale).toBeTruthy();
      expect(catalog["localAgents.toggle"], locale).toBeTruthy();
      expect(catalog["localAgents.history.title"], locale).toBeTruthy();
      expect(catalog["localAgents.history.detail"], locale).toBeTruthy();
      expect(catalog["localAgents.history.toggle"], locale).toBeTruthy();
      expect(catalog["localAgentHooks.title"], locale).toBeTruthy();
      expect(catalog["localAgentHooks.manage"], locale).toBeTruthy();
      expect(catalog["localAgentHooks.choose"], locale).toBeTruthy();
      expect(catalog["localAgentHooks.status.installed"], locale).toBeTruthy();
      expect(catalog["appearance.agentFileActivity.title"], locale).toBeTruthy();
      for (const key of [
        "title",
        "detail",
        "accessTitle",
        "accessDetail",
        "localOnly",
        "enable",
        "enabling",
        "error",
      ]) {
        expect(
          catalog[`appearance.agentFileActivity.permission.${key}`],
          `${locale}: settings.appearance.agentFileActivity.permission.${key}`,
        ).toBeTruthy();
      }
      for (const key of [
        "selectorLabel",
        "system",
        "changing",
        "changeFailed",
      ]) {
        expect(catalog[`language.${key}`], `${locale}: settings.language.${key}`).toBeTruthy();
      }
      for (const key of [
        "title",
        "detail",
        "name",
        "path",
        "mode",
        "modeLocal",
        "status",
        "protected",
        "recentWorkspace",
        "unlink.title",
        "unlink.action",
        "unlink.progress",
        "unlink.confirm",
      ]) {
        expect(catalog[`localProject.${key}`], `${locale}: settings.localProject.${key}`).toBeTruthy();
      }
    }
  });

  it("keeps version identity in Settings General and out of every Side Panel placement", () => {
    const general = source("src/features/settings/main/GeneralSettingsView.tsx");
    const footer = source("src/features/app-shell/navigation/DesktopSidebarFooterNavigation.tsx");
    const surface = source("src/features/app-shell/DesktopDataWorkspaceSurface.tsx");
    const dataShell = source("src/features/data-workspace/data-shell.css");

    expect(general).toContain("<DesktopBuildVersionSettingsRow />");
    expect(footer).not.toContain("DesktopBuildIdentity");
    expect(surface).not.toContain("DesktopBuildIdentity");
    expect(dataShell).not.toContain("desktop-build-identity-badge");
  });

  it("offers every loading animation preset from Appearance with localized labels", () => {
    const view = source("src/features/settings/SettingsView.tsx");
    const appearancePreferences = source("src/features/appearance/appearancePreferences.ts");
    const loading = source("src/components/loading/index.tsx");
    const manifest = JSON.parse(source("locales/manifest.json")) as {
      locales: Array<{ locale: string }>;
    };

    expect(view).toContain("PULSE_GRID_PRESET_IDS.map");
    expect(view).toContain("PULSE_GRID_PRESET_FRAMES[presetId]");
    expect(view).toContain("onLoadingAnimationPresetChange(presetId)");
    expect(view.indexOf('settings.appearance.loadingAnimation.title'))
      .toBeGreaterThan(view.indexOf('settings.appearance.navigation.title'));
    expect(appearancePreferences).toContain("loadingAnimationPreset: LoadingAnimationPreset");
    expect(loading).toContain("LoadingAnimationContext");
    expect(loading).not.toContain("localStorage");

    for (const { locale } of manifest.locales) {
      const catalog = JSON.parse(source(`locales/renderer/${locale}/settings.json`)) as Record<string, string>;
      for (const key of [
        "title",
        "ariaLabel",
        "ikun.label",
        "ikun.description",
        "ymca.label",
        "ymca.description",
        "siu.label",
        "siu.description",
      ]) {
        expect(catalog[`appearance.loadingAnimation.${key}`], `${locale}: ${key}`).toBeTruthy();
      }
    }
  });

  it("uses one flat Settings contract and removes legacy card primitives", () => {
    const components = source("src/features/settings/components.tsx");
    const view = source("src/features/settings/SettingsView.tsx");
    const workspaceConfig = source("src/features/settings/PuppyoneWorkspaceConfigSettings.tsx");
    const splitViews = [
      "AccountSettingsView.tsx",
      "ExperimentalSettingsView.tsx",
      "FileSettingsViews.tsx",
      "GeneralSettingsView.tsx",
      "LocalProjectSettingsView.tsx",
      "ProductAnalyticsSettingsRow.tsx",
      "PrivacySettingsView.tsx",
      "RepositorySettingsViews.tsx",
    ].map((fileName) => source(`src/features/settings/main/${fileName}`)).join("\n");
    const settingsImplementation = `${components}\n${view}\n${workspaceConfig}\n${splitViews}`;
    const settings = source("src/styles/settings.css");

    expect(components).toContain("SettingsSubsection");
    expect(components).toContain("SettingsValueRow");
    expect(settingsImplementation).not.toMatch(/Settings(?:Group|Line)/);
    expect(settingsImplementation).not.toContain("desktop-settings-label-stack");
    expect(settings).not.toContain(".desktop-settings-group");
    expect(settings).not.toContain(".desktop-settings-line");
    expect(settings).not.toContain(".desktop-settings-label-stack");
    expect(settings).toMatch(/\.desktop-settings-subsection-body\s*{[^}]*display:\s*grid;/s);
    expect(settings).toMatch(/\.desktop-settings-subsection-title\s*{[^}]*font-size:\s*12px;[^}]*font-weight:\s*500;/s);

    for (const detailId of [
      "settings.appearance.detail",
      "settings.general.detail",
      "settings.privacy.detail",
      "settings.localProject.detail",
      "settings.account.detail",
      "settings.experimental.detail",
      "settings.files.detail",
      "settings.cloud.detail",
      "settings.git.detail",
    ]) {
      expect(settingsImplementation, detailId).toContain(detailId);
    }
  });

  it("locks the compact Appearance-derived dimensions and responsive rules", () => {
    const view = source("src/features/settings/SettingsView.tsx");
    const settings = source("src/styles/settings.css");
    const controls = source("src/styles/settings-controls.css");
    const language = source("src/styles/settings-view.css");
    const localProject = source("src/features/settings/main/LocalProjectSettingsView.tsx");
    const repository = source("src/features/settings/main/RepositorySettingsViews.tsx");

    expect(settings).toMatch(
      /--desktop-settings-content-max-width:\s*var\(--po-reading-content-width, 724px\)/,
    );
    expect(source("src/styles/settings-new-menu.css")).not.toContain(
      "--desktop-settings-content-max-width",
    );
    expect(settings).toMatch(/\.desktop-settings-heading-row\s*{[^}]*padding-inline:\s*10px;/s);
    expect(settings).toMatch(/\.desktop-settings-section-header\s*{[^}]*padding-inline:\s*10px;/s);
    expect(settings).toMatch(/\.desktop-settings-heading-row \.desktop-settings-section-header\s*{[^}]*padding-inline:\s*0;/s);
    expect(settings).toMatch(/\.desktop-settings-section-header h2\s*{[^}]*font-size:\s*15px;[^}]*font-weight:\s*var\(--po-text-weight-medium, 500\);[^}]*line-height:\s*20px;/s);
    expect(settings).toMatch(/\.desktop-settings-row\s*{[^}]*gap:\s*18px;[^}]*padding:\s*0 10px;/s);
    expect(settings).toMatch(/\.desktop-settings-row > \.desktop-settings-row-value\s*{[^}]*font-weight:\s*var\(--po-text-weight-regular, 400\);/s);
    expect(settings).toMatch(/\.desktop-settings-value-text\s*{[^}]*font-weight:\s*var\(--po-text-weight-regular, 400\);/s);
    expect(settings).toMatch(/\.desktop-settings-remote-setting-name\s*{[^}]*font-weight:\s*var\(--po-text-weight-regular, 400\);/s);
    expect(controls).toMatch(/\.desktop-settings-row-control\s*{[^}]*min-height:\s*42px;/s);
    expect(controls).not.toContain("min-height: 38px");
    expect(settings).toMatch(/\.desktop-settings-value-row\s*{[^}]*min-height:\s*30px;/s);
    expect(settings).toMatch(/\.desktop-settings-select,[\s\S]*?height:\s*28px;[\s\S]*?border-radius:\s*6px;[\s\S]*?font-weight:\s*var\(--po-text-weight-regular, 400\);/);
    expect(controls).toMatch(/\.desktop-settings-action\s*{[^}]*height:\s*28px;[^}]*border-radius:\s*6px;[^}]*font-size:\s*12px;[^}]*font-weight:\s*var\(--po-text-weight-medium, 500\);/s);
    expect(controls).toMatch(/\.desktop-build-version-text\s*{[^}]*font-weight:\s*400;/s);
    expect(controls).toMatch(/\.desktop-theme-segment\s*{[^}]*border-radius:\s*7px;/s);
    expect(controls).toMatch(/\.desktop-theme-segment button\s*{[^}]*height:\s*26px;[^}]*border-radius:\s*5px;/s);
    expect(controls).toMatch(/\.desktop-appearance-option-segment\s*{[^}]*width:\s*min\(100%, 360px\);[^}]*grid-auto-columns:\s*minmax\(0, 1fr\);/s);
    expect(controls).toMatch(/\.desktop-appearance-option-segment\.desktop-appearance-hug-segment\s*{[^}]*width:\s*fit-content;[^}]*max-width:\s*100%;[^}]*grid-auto-columns:\s*max-content;/s);
    expect(controls).toMatch(/\.desktop-settings-tool-list\s*{[^}]*width:\s*fit-content;[^}]*max-width:\s*100%;/s);
    expect(controls).toMatch(/\.desktop-settings-tool-item\s*{[^}]*grid-template-columns:\s*minmax\(0, max-content\) auto;[^}]*gap:\s*8px;[^}]*padding-inline:\s*8px 0;/s);
    expect(settings).not.toContain(".desktop-settings-wide-control-row > .desktop-settings-tool-list");
    expect(view.match(/desktop-theme-segment desktop-appearance-option-segment/g)).toHaveLength(4);
    expect(view.match(/desktop-appearance-hug-segment/g)).toHaveLength(3);
    expect(view).not.toContain("settings.appearance.editorPresentation");
    expect(view).not.toContain("settings.appearance.dockIcon");
    expect(localProject).not.toContain("<strong");
    expect(repository).not.toContain("<strong");
    expect(controls).not.toContain("desktop-dock-icon-segment");
    expect(view).toContain("settings.appearance.gitSidebarLayout.title");
    expect(controls).not.toContain(".desktop-loading-animation-segment");
    expect(controls).not.toContain(".desktop-text-size-segment");
    expect(controls).not.toContain(".desktop-sidebar-layout-segment");
    expect(settings).toContain("@media (max-width: 760px)");
    expect(settings).toContain(".desktop-settings-wide-control-row");

    expect(language).not.toContain("min(300px, 48%)");
    expect(language).not.toContain("min-height: 32px");
    expect(language).not.toContain("border-radius: 8px");
    expect(language).not.toContain("var(--po-panel-raised)");
    expect(language).toMatch(/\.desktop-language-setting-control\s*{[^}]*width:\s*fit-content;[^}]*max-width:\s*100%;/s);
    expect(language).toMatch(/\.desktop-language-setting-select\s*{[^}]*width:\s*fit-content;[^}]*field-sizing:\s*content;/s);
  });

  it("keeps hover feedback on interactive controls rather than layout rows", () => {
    const settings = source("src/styles/settings.css");
    const controls = source("src/styles/settings-controls.css");

    expect(settings).not.toContain(".desktop-settings-row:hover");
    expect(settings).not.toContain(".desktop-puppyone-config-row:hover");
    expect(settings).toContain(".desktop-settings-row-action:hover:not(:disabled)");
    expect(controls).toContain(".desktop-theme-segment button:hover");
    expect(controls).toContain(".desktop-theme-choice:hover");
  });
});

function source(relativePath: string) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

function expectInOrder(sourceText: string, needles: string[]) {
  let cursor = -1;
  for (const needle of needles) {
    const next = sourceText.indexOf(needle, cursor + 1);
    expect(next, needle).toBeGreaterThan(cursor);
    cursor = next;
  }
}
