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
    { messageKey: "builtInAgent", settingKey: "enableBuiltInAgent" },
    { messageKey: "projectSwitcherRail", settingKey: "enableProjectSwitcherRail" },
    { messageKey: "multiRootWorkspaces", settingKey: "enableMultiRootWorkspaces" },
    { messageKey: "notionImport", settingKey: "enableNotionImport" },
    { messageKey: "googleDriveImport", settingKey: "enableGoogleDriveImport" },
    { messageKey: "obsidianImport", settingKey: "enableObsidianImport" },
    { messageKey: "airtableImport", settingKey: "enableAirtableImport" },
    { messageKey: "viewerPlugins", settingKey: "enableViewerPlugins" },
    { messageKey: "editorSaveStatus", settingKey: "enableEditorSaveStatus" },
    ...(window.puppyoneDesktop?.getGitAutoCommitSettings
      ? [{ messageKey: "gitAutoCommit", settingKey: "enableGitAutoCommit" as const }]
      : []),
    { messageKey: "markdownBlockDrag", settingKey: "enableMarkdownBlockDrag" },
    { messageKey: "markdownHeadingOutline", settingKey: "enableMarkdownHeadingOutline" },
    ...(assetLibraryHomeAvailable
      ? [{ messageKey: "projectsHome", settingKey: "enableAssetLibraryHome" as const }]
      : []),
    { messageKey: "cloudWorkspace", settingKey: "enableCloudWorkspace" },
    { messageKey: "cloudAutomation", settingKey: "enableCloudAutomation" },
    { messageKey: "flowFiles", settingKey: "enablePuppyFlowFiles" },
  ];

  return (
    <section className="desktop-utility-view desktop-settings-view">
      <div className="desktop-utility-body desktop-settings-body" data-po-scrollbar="content">
        <div className="desktop-settings-section">
          <SettingsSectionHeader
            title={t("settings.experimental.title")}
            detail={t("settings.experimental.detail")}
          />
          <div className="desktop-settings-list">
            {rows.map(({ messageKey, settingKey }) => (
              <div className="desktop-settings-row desktop-settings-row-control" key={settingKey}>
                <span title={t(`settings.experimental.${messageKey}.detail`)}>
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
