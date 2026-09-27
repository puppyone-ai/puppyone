import { useEffect, useState } from "react";
import { Check, RefreshCw } from "lucide-react";
import { useLocalization } from "@puppyone/localization";
import {
  DEFAULT_EXPLORER_EXCLUDE_PATTERNS,
  normalizeExplorerExcludePatterns,
  type FilesVisibilitySettings,
} from "../../../preferences";
import { SettingsSectionHeader, SettingsSubsection } from "../components";

export function FilesSettingsView({
  settings,
  onChange,
}: {
  settings: FilesVisibilitySettings;
  onChange: (settings: FilesVisibilitySettings) => void;
}) {
  const { t } = useLocalization();
  const savedPatternText = settings.excludePatterns.join("\n");
  const [patternDraft, setPatternDraft] = useState(savedPatternText);
  const normalizedDraft = normalizeExplorerExcludePatterns(patternDraft);
  const patternsDirty = normalizedDraft.join("\n") !== savedPatternText;

  useEffect(() => setPatternDraft(savedPatternText), [savedPatternText]);

  const applyPatterns = () => onChange({ ...settings, excludePatterns: normalizedDraft });
  const resetPatterns = () => {
    const nextPatterns = [...DEFAULT_EXPLORER_EXCLUDE_PATTERNS];
    setPatternDraft(nextPatterns.join("\n"));
    onChange({ ...settings, excludePatterns: nextPatterns });
  };

  return (
    <section className="desktop-utility-view desktop-settings-view">
      <div className="desktop-utility-body desktop-settings-body" data-po-scrollbar="content">
        <div className="desktop-settings-section desktop-files-settings-section">
          <SettingsSectionHeader title={t("settings.files.title")} />
          <SettingsSubsection leading>
            <div className="desktop-settings-row desktop-settings-row-control desktop-settings-toggle-row desktop-files-toggle-row">
              <span>{t("settings.files.showHidden")}</span>
              <label className="desktop-settings-switch">
                <input
                  type="checkbox"
                  aria-label={t("settings.files.showHidden")}
                  checked={settings.showHiddenFiles}
                  onChange={(event) => onChange({ ...settings, showHiddenFiles: event.target.checked })}
                />
                <span aria-hidden="true" />
              </label>
            </div>
            <div className="desktop-settings-row desktop-settings-pattern-editor desktop-files-pattern-editor">
              <span data-tooltip={t("settings.files.patternCount", { count: normalizedDraft.length })}>
                {t("settings.files.excludePatterns")}
              </span>
              <div className="desktop-settings-pattern-control">
                <textarea
                  aria-label={t("settings.files.excludePatterns")}
                  aria-description={t("settings.files.patternCount", { count: normalizedDraft.length })}
                  value={patternDraft}
                  spellCheck={false}
                  onChange={(event) => setPatternDraft(event.target.value)}
                />
                <div className="desktop-settings-pattern-editor-footer">
                  <button className="desktop-settings-row-action" type="button" disabled={!patternsDirty} onClick={applyPatterns}>
                    <Check size={13} /><span>{t("common.action.apply")}</span>
                  </button>
                  <button className="desktop-settings-row-action" type="button" onClick={resetPatterns}>
                    <RefreshCw size={13} /><span>{t("common.action.reset")}</span>
                  </button>
                </div>
              </div>
            </div>
          </SettingsSubsection>
        </div>
      </div>
    </section>
  );
}
