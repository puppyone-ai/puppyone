import { useState } from "react";
import { Search, X } from "lucide-react";
import { useLocalization } from "@puppyone/localization";
import { useDesktopPlatformCapabilities } from "../../../platform";
import { SettingsSectionHeader } from "../components";
import { KEYBOARD_SHORTCUTS, shortcutKeys, shortcutKeycaps, type ShortcutPlatform } from "../keyboardShortcuts";

function normalizeSearch(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase()
    .replaceAll("⌘", " command cmd meta mod ").replaceAll("⌥", " option alt ")
    .replaceAll("⇧", " shift ").replaceAll("ctrl", " control ctrl ")
    .replaceAll("--", " minus ").replace(/(^|\s)-(?=$|\s)/g, " minus ")
    .replace(/[+_-]/g, " ");
}
export function KeyboardShortcutsSettingsView({ initialPlatform }: { initialPlatform?: ShortcutPlatform }) {
  const { t } = useLocalization();
  const platformLabels = { mac: "macOS", windows: "Windows", linux: "Linux" };
  const capabilities = useDesktopPlatformCapabilities();
  const [chosenPlatform, setPlatform] = useState<ShortcutPlatform | null>(initialPlatform ?? null);
  const platform: ShortcutPlatform = chosenPlatform ?? (capabilities?.platform === "macos" ? "mac" : capabilities?.platform ?? "mac");
  const [query, setQuery] = useState("");
  const words = normalizeSearch(query).trim().split(/\s+/).filter(Boolean);
  const rows = KEYBOARD_SHORTCUTS.filter(shortcut => {
    if (shortcut.platforms && !shortcut.platforms.includes(platform)) return false;
    const keys = shortcutKeys(shortcut, platform);
    const searchable = normalizeSearch([t(shortcut.labelId), t(`settings.shortcuts.group.${shortcut.group}`), shortcut.id,
      ...keys, ...keys.map(key => shortcutKeycaps(key, platform).join(" "))].join(" "));
    return words.every(word => searchable.includes(word));
  });
  const groups = [...new Set(rows.map(row => row.group))];
  return (
    <section className="desktop-utility-view desktop-settings-view">
      <div className="desktop-utility-body desktop-settings-body" data-po-scrollbar="content">
        <div className="desktop-settings-section desktop-shortcuts-settings">
          <SettingsSectionHeader title={t("settings.shortcuts.title")} />
          <p className="desktop-shortcuts-detail">{t("settings.shortcuts.detail")}</p>
          <div className="desktop-shortcuts-toolbar">
            <div className="desktop-shortcuts-search">
              <Search size={15} aria-hidden="true" />
              <input type="search" value={query} onChange={event => setQuery(event.currentTarget.value)}
                aria-label={t("settings.shortcuts.searchLabel")} placeholder={t("settings.shortcuts.searchPlaceholder")} />
              {query && <button type="button" aria-label={t("settings.shortcuts.clearSearch")} onClick={() => setQuery("")}><X size={14} aria-hidden="true" /></button>}
            </div>
            <div className="desktop-theme-segment desktop-shortcuts-platform" role="group" aria-label={t("settings.shortcuts.platform")}>
              {(["mac", "windows", "linux"] as const).map(value => <button type="button" key={value}
                aria-pressed={platform === value} className={platform === value ? "is-active" : ""}
                onClick={() => setPlatform(value)}>{platformLabels[value]}</button>)}
            </div>
          </div>
          <div className="desktop-shortcuts-results">
            {groups.length === 0 && <p className="desktop-shortcuts-empty" role="status">{t("settings.shortcuts.noResults")}</p>}
            {groups.map(group => <section className="desktop-shortcuts-group" key={group} aria-labelledby={`shortcut-group-${group}`}>
              <h3 id={`shortcut-group-${group}`}>{t(`settings.shortcuts.group.${group}`)}</h3>
              <p className="desktop-shortcuts-scope">{t(`settings.shortcuts.scope.${group}`)}</p>
              <table className="desktop-shortcuts-table">
                <thead><tr><th scope="col">{t("settings.shortcuts.action")}</th><th scope="col">{t("settings.shortcuts.keys")}</th></tr></thead>
                <tbody>{rows.filter(row => row.group === group).map(row => <tr key={row.id} data-shortcut-id={row.id}>
                  <td>{t(row.labelId)}</td>
                  <td><span className="desktop-shortcut-alternatives">{shortcutKeys(row, platform).map((key, index) => <span className="desktop-shortcut-alternative" key={key}>
                    {index > 0 && <span className="desktop-shortcut-or">{t("settings.shortcuts.or")}</span>}
                    <span className="desktop-shortcut-chord" aria-label={shortcutKeycaps(key, platform).join(" + ")}>
                      {shortcutKeycaps(key, platform).map((cap, capIndex) => <kbd key={`${capIndex}-${cap}`}>{cap}</kbd>)}
                    </span>
                  </span>)}</span></td>
                </tr>)}</tbody>
              </table>
            </section>)}
          </div>
        </div>
      </div>
    </section>
  );
}
