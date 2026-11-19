import { useState } from "react";
import {
  isSelectableAppLanguagePreference,
  resolveSystemLocale,
  useLocalization,
  type AppLanguagePreference,
} from "@puppyone/localization";

export function LanguageSettingRow() {
  const {
    preference,
    localeDescriptors,
    systemLanguages,
    status,
    t,
    setLanguagePreference,
  } = useLocalization();
  const [changeFailed, setChangeFailed] = useState(false);
  const changing = status === "changing";
  const systemLocale = resolveSystemLocale(systemLanguages);
  const systemLanguage = localeDescriptors.find((descriptor) => descriptor.locale === systemLocale)?.label
    ?? systemLocale;

  const changeLanguage = async (nextPreference: AppLanguagePreference) => {
    setChangeFailed(false);
    try {
      await setLanguagePreference(nextPreference);
    } catch {
      setChangeFailed(true);
    }
  };

  return (
    <label className="desktop-settings-row desktop-settings-row-control desktop-language-setting-row">
      <span>{t("settings.language.selectorLabel")}</span>
      <div className="desktop-language-setting-control">
        <select
          className="desktop-settings-select desktop-language-setting-select"
          aria-label={t("settings.language.selectorLabel")}
          value={preference}
          disabled={changing}
          aria-busy={changing}
          onChange={(event) => {
            const nextPreference = event.target.value;
            if (isSelectableAppLanguagePreference(nextPreference)) {
              void changeLanguage(nextPreference);
            }
          }}
        >
          <option value="system">
            {changing && preference === "system" ? t("settings.language.changing") : t("settings.language.system", { language: systemLanguage })}
          </option>
          {localeDescriptors.filter((descriptor) => descriptor.productionReady).map((descriptor) => (
            <option
              key={descriptor.locale}
              value={descriptor.locale}
              lang={descriptor.locale}
              dir={descriptor.direction}
            >
              {changing && preference === descriptor.locale ? t("settings.language.changing") : descriptor.label}
            </option>
          ))}
        </select>
        {changing && (
          <span className="desktop-settings-visually-hidden" role="status">
            {t("settings.language.changing")}
          </span>
        )}
        {changeFailed && (
          <small className="desktop-language-setting-error" role="alert">
            {t("settings.language.changeFailed")}
          </small>
        )}
      </div>
    </label>
  );
}
