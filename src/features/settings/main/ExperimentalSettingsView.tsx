import { useLocalization } from "@puppyone/localization";
import type { ExperimentalSettings } from "../../../preferences";
import { SettingsSectionHeader, SettingsSubsection, SettingsToggle } from "../components";

export function ExperimentalSettingsView({
  settings,
  assetLibraryHomeAvailable,
  onChange,
}: {
  settings: ExperimentalSettings;
  assetLibraryHomeAvailable: boolean;
  onChange: (settings: ExperimentalSettings) => void;
}) {
  const { t } = useLocalization();
  const groups: Array<{
    id: string;
    rows: Array<{ messageKey: string; settingKey: keyof ExperimentalSettings }>;
  }> = [
    {
      id: "header",
      rows: [
        { messageKey: "editorTabsInHeader", settingKey: "enableEditorTabsInHeader" },
        { messageKey: "centerProjectInHeader", settingKey: "enableCenteredProjectInHeader" },
        { messageKey: "gitCardInHeader", settingKey: "enableGitCardInHeader" },
        { messageKey: "workbenchTabsInHeader", settingKey: "enableWorkbenchTabsInHeader" },
        { messageKey: "shareOnboarding", settingKey: "enableShareOnboarding" },
        { messageKey: "projectSwitcherRail", settingKey: "enableProjectSwitcherRail" },
        { messageKey: "multiRootWorkspaces", settingKey: "enableMultiRootWorkspaces" },
        { messageKey: "alwaysShowOnboardingCoachmarks", settingKey: "enableAlwaysShowOnboardingCoachmarks" },
        ...(assetLibraryHomeAvailable
          ? [{ messageKey: "projectsHome", settingKey: "enableAssetLibraryHome" as const }]
          : []),
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
                {rows.map(({ messageKey, settingKey }) => (
                  <div className="desktop-settings-row desktop-settings-row-control" key={settingKey}>
                    <span>{t(`settings.experimental.${messageKey}.title`)}</span>
                    <SettingsToggle
                      label={t(`settings.experimental.${messageKey}.title`)}
                      description={t(`settings.experimental.${messageKey}.detail`)}
                      checked={settings[settingKey]}
                      onChange={(checked) => onChange({ ...settings, [settingKey]: checked })}
                    />
                  </div>
                ))}
              </div>
            </SettingsSubsection>
          ))}
        </div>
      </div>
    </section>
  );
}
