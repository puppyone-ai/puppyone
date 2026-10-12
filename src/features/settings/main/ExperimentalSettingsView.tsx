import { useDesktopPreference } from "../../../preferencesStore";
import { useFeatureFlag } from "../../flags";
import { useLocalization } from "@puppyone/localization";
import type { ExperimentalSettings } from "../../../preferences";
import { SettingsSectionHeader, SettingsSubsection, SettingsToggle } from "../components";

export function ExperimentalSettingsView() {
  const settings = useDesktopPreference(s => s.experimentalSettings);
  const onChange = useDesktopPreference(s => s.setExperimentalSettings);
  const assetLibraryHomeAvailable = useFeatureFlag("assetLibraryHome");
  const { t } = useLocalization();
  const groups: Array<{
    id: string;
    rows: Array<{
      messageKey: string;
      settingKey: keyof ExperimentalSettings;
      choices?: Array<{ messageKey: string; value: boolean }>;
    }>;
  }> = [
    {
      id: "header",
      rows: [
        { messageKey: "projectReach", settingKey: "enableProjectReach" },
        { messageKey: "projectHeaderAlignment", settingKey: "enableCenteredProjectInHeader",
          choices: [{ messageKey: "left", value: false }, { messageKey: "center", value: true }] },
        { messageKey: "projectLocationIconsInHeader", settingKey: "enableProjectLocationIconsInHeader",
          choices: [{ messageKey: "menu", value: false }, { messageKey: "header", value: true }] },
        { messageKey: "workbenchTabsInHeader", settingKey: "enableWorkbenchTabsInHeader",
          choices: [{ messageKey: "sidebar", value: false }, { messageKey: "header", value: true }] },
        { messageKey: "shareOnboarding", settingKey: "enableShareOnboarding" },
        { messageKey: "projectSwitcherRail", settingKey: "enableProjectSwitcherRail",
          choices: [{ messageKey: "menu", value: false }, { messageKey: "sidebar", value: true }] },
        { messageKey: "multiRootWorkspaces", settingKey: "enableMultiRootWorkspaces" },
        { messageKey: "alwaysShowOnboardingCoachmarks", settingKey: "enableAlwaysShowOnboardingCoachmarks",
          choices: [{ messageKey: "once", value: false }, { messageKey: "repeat", value: true }] },
        { messageKey: "editorTabsInHeader", settingKey: "enableEditorTabsInHeader",
          choices: [{ messageKey: "panes", value: false }, { messageKey: "header", value: true }] },
      ],
    },
    {
      id: "markdown",
      rows: [
        { messageKey: "markdownBlockDrag", settingKey: "enableMarkdownBlockDrag" },
        { messageKey: "markdownHeadingOutline", settingKey: "enableMarkdownHeadingOutline" },
      ],
    },
    {
      id: "imports",
      rows: [
        { messageKey: "otherAppImports", settingKey: "enableOtherAppImports" },
        { messageKey: "viewerPlugins", settingKey: "enableViewerPlugins" },
      ],
    },
    {
      id: "cloud",
      rows: [
        { messageKey: "cloudWorkspace", settingKey: "enableCloudWorkspace" },
        { messageKey: "cloudAutomation", settingKey: "enableCloudAutomation" },
        { messageKey: "flowFiles", settingKey: "enablePuppyFlowFiles" },
        ...(window.puppyoneDesktop?.getGitAutoCommitSettings
          ? [{ messageKey: "gitAutoCommit", settingKey: "enableGitAutoCommit" as const }]
          : []),
      ],
    },
    ...(assetLibraryHomeAvailable || settings.enableAssetLibraryHome ? [{
      id: "homepage",
      rows: [{ messageKey: "projectsHome", settingKey: "enableAssetLibraryHome" as const,
        choices: [{ messageKey: "list", value: false }, { messageKey: "cards", value: true }] }],
    }] : []),
  ];

  return (
    <section className="desktop-utility-view desktop-settings-view">
      <div className="desktop-utility-body desktop-settings-body" data-po-scrollbar="content">
        <div className="desktop-settings-section">
          <SettingsSectionHeader
            title={t("settings.experimental.title")}
          />
          {groups.map(({ id, rows }, index) => (
            <SettingsSubsection key={id} title={t(`settings.experimental.groups.${id}`)} leading={index === 0}>
              <div className="desktop-settings-list">
                {rows.map(({ messageKey, settingKey, choices }) => {
                  const label = t(`settings.experimental.${messageKey}.title`);
                  const description = messageKey === "projectHeaderAlignment"
                    ? undefined : t(`settings.experimental.${messageKey}.detail`);
                  return <div className={`desktop-settings-row desktop-settings-row-control${choices ? " desktop-settings-choice-row" : ""}`} key={settingKey}>
                    <span>{label}</span>
                    {choices ? <div className="desktop-theme-segment" role="group" aria-label={label} aria-description={description}>
                      {choices.map(choice => <button key={choice.messageKey} type="button"
                        className={settings[settingKey] === choice.value ? "active" : ""}
                        aria-pressed={settings[settingKey] === choice.value}
                        onClick={() => onChange({ ...settings, [settingKey]: choice.value })}>
                        {t(`settings.experimental.${messageKey}.${choice.messageKey}`)}
                      </button>)}
                    </div> : <SettingsToggle
                      label={label}
                      description={description}
                      checked={settings[settingKey]}
                      onChange={(checked) => onChange({ ...settings, [settingKey]: checked })}
                    />}
                  </div>;
                })}
              </div>
            </SettingsSubsection>
          ))}
        </div>
      </div>
    </section>
  );
}
