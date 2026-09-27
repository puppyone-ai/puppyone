import { useLocalization } from "@puppyone/localization";
import type { ExperimentalSettings } from "../../../preferences";
import { SettingsSectionHeader, SettingsToggle } from "../components";

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
  const rows: Array<{
    messageKey: string;
    settingKey: keyof ExperimentalSettings;
  }> = [
    { messageKey: "projectSwitcherRail", settingKey: "enableProjectSwitcherRail" },
    { messageKey: "multiRootWorkspaces", settingKey: "enableMultiRootWorkspaces" },
    { messageKey: "otherAppImports", settingKey: "enableOtherAppImports" },
    { messageKey: "viewerPlugins", settingKey: "enableViewerPlugins" },
    ...(window.puppyoneDesktop?.getGitAutoCommitSettings
      ? [{ messageKey: "gitAutoCommit", settingKey: "enableGitAutoCommit" as const }]
      : []),
    { messageKey: "markdownBlockDrag", settingKey: "enableMarkdownBlockDrag" },
    { messageKey: "markdownHeadingOutline", settingKey: "enableMarkdownHeadingOutline" },
    ...(assetLibraryHomeAvailable
      ? [{ messageKey: "projectsHome", settingKey: "enableAssetLibraryHome" as const }]
      : []),
    { messageKey: "cloudWorkspace", settingKey: "enableCloudWorkspace" },
    { messageKey: "workbenchTabsInHeader", settingKey: "enableWorkbenchTabsInHeader" },
    { messageKey: "cloudAutomation", settingKey: "enableCloudAutomation" },
    { messageKey: "flowFiles", settingKey: "enablePuppyFlowFiles" },
  ];

  return (
    <section className="desktop-utility-view desktop-settings-view">
      <div className="desktop-utility-body desktop-settings-body" data-po-scrollbar="content">
        <div className="desktop-settings-section">
          <SettingsSectionHeader
            title={t("settings.experimental.title")}
          />
          <div className="desktop-settings-list desktop-settings-lead-list">
            {rows.map(({ messageKey, settingKey }) => (
              <div className="desktop-settings-row desktop-settings-row-control" key={settingKey}>
                <span>
                  {t(`settings.experimental.${messageKey}.title`)}
                </span>
                <SettingsToggle
                  label={t(`settings.experimental.${messageKey}.title`)}
                  description={t(`settings.experimental.${messageKey}.detail`)}
                  checked={settings[settingKey]}
                  onChange={(checked) => onChange({ ...settings, [settingKey]: checked })}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
