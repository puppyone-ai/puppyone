import "../../../../src/styles/cascade.css";
import "../../../../src/styles.css";
import { useLayoutEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { TestLocalizationProvider } from "@puppyone/localization/testing";
import englishCatalog from "../../../../src/localization/catalog-loaders/en";
import chineseCatalog from "../../../../src/localization/catalog-loaders/zh-Hans";
import { initializeDesktopPreferences } from "../../../../src/preferencesStore";
import { KeyboardShortcutsSettingsView } from "../../../../src/features/settings/main/KeyboardShortcutsSettingsView";
import { SettingsSidebar } from "../../../../src/features/settings/sidebar/SettingsSidebar";
import { resolveAppearance } from "../../../../src/features/appearance/resolveAppearance";
import { applySurfaceAppearanceToElement, resolveSurfaceAppearance, SurfaceAppearanceProvider } from "../../../../src/features/appearance/AppearanceRuntime";
import { createSubThemeCatalogSnapshot } from "../../../../src/features/themes/builtinSubThemes";
import { DEFAULT_TYPOGRAPHY_PREFERENCES, resolveTypography } from "../../../../src/features/typography";
import { DEFAULT_MARKDOWN_PRESENTATION_SETTINGS } from "../../../../src/features/markdown/markdownPresentation";
import { MarkdownCodeMirrorEditor } from "../../../../src/shared-ui/editor/markdown/MarkdownCodeMirrorEditor";

initializeDesktopPreferences({ getItem: () => null, setItem: () => {}, removeItem: () => {} });
const parameters = new URLSearchParams(location.search);
const themeMode = parameters.get("theme") === "dark" ? "dark" : "light";
function Harness() {
  const [catalog] = useState(() => createSubThemeCatalogSnapshot({ themes: [], diagnostics: [] }));
  const appearance = resolveAppearance({ interfaceStyle: "default", themeMode,
    requestedSubThemeIds: { light: "default.neutral", dark: "default.dark" }, subThemeCatalog: catalog,
    sidebarNavigationLayout: "bottom-horizontal", fileIconTheme: "default" });
  const surface = resolveSurfaceAppearance({ appearance, typography: resolveTypography(DEFAULT_TYPOGRAPHY_PREFERENCES),
    markdownPresentation: DEFAULT_MARKDOWN_PRESENTATION_SETTINGS, lightThemePreset: "neutral", darkThemePreset: "default",
    pointerCursors: false, diffMarkers: "color" });
  useLayoutEffect(() => applySurfaceAppearanceToElement(document.documentElement, surface), [surface]);
  const chinese = parameters.get("lang") === "zh-Hans";
  return <TestLocalizationProvider messages={chinese ? chineseCatalog : englishCatalog}><SurfaceAppearanceProvider value={surface}>
    <div {...surface.rootProps} className={themeMode === "dark" ? "dark" : ""} style={{ ...surface.rootProps.style, height: "100vh", background: "var(--po-canvas)", color: "var(--po-text)", display: "grid", placeItems: "center" }}>
      {parameters.get("view") === "editor" ? <div style={{ width: "100%", height: "100%" }}>
        <MarkdownCodeMirrorEditor value={'# Keyboard shortcut acceptance\n\nSelect this paragraph and try a formatting or insertion shortcut.\n\n- [ ] A task\n\nLast paragraph.'} readOnly={false} livePreview blockDragEnabled />
      </div> : <div className="desktop-settings-dialog" style={{ display: "flex", flexDirection: "column", height: "min(760px, calc(100vh - 40px))", width: parameters.get("width") ? `${Number(parameters.get("width"))}px` : undefined, maxWidth: "calc(100vw - 32px)" }}>
        <header className="desktop-settings-dialog-header" style={{ display: "flex", alignItems: "center", padding: "0 18px" }}>{chinese ? "设置" : "Settings"}</header>
        <div className="desktop-settings-dialog-layout">
          <aside className="desktop-settings-dialog-navigation"><SettingsSidebar activeSection="keyboard-shortcuts" cloudEnabled={false} onSelectSection={() => {}} /></aside>
          <div className="desktop-settings-dialog-content"><KeyboardShortcutsSettingsView initialPlatform="mac" /></div>
        </div>
      </div>}
    </div>
  </SurfaceAppearanceProvider></TestLocalizationProvider>;
}
createRoot(document.getElementById("root")!).render(<Harness />);
