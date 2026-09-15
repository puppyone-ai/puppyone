import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(new URL(`../../../../${path}`, import.meta.url), "utf8");

describe("Sub Theme settings", () => {
  it("offers root-compatible visual variants without editor implementation controls", () => {
    const section = source("src/features/settings/main/SubThemeSettingsSection.tsx");

    expect(section).toContain("requestedSubThemeId");
    expect(section).toContain("effectiveSubThemeId");
    expect(section).toContain("rootThemeId");
    expect(section).toContain("effectiveColorMode");
    expect(section).toContain("onSubThemeChange");
    expect(section).toContain("listSelectableSubThemes");
    expect(section).toContain("listSelectableSubThemes(");
    expect(section).not.toContain("desktop-sub-theme-mode-badge");
    expect(section).toContain("FolderOpen");
    expect(section).toContain("<Plus");
    expect(section).toContain("settings.appearance.themes.add");
    expect(section).toContain("catalog.createTheme");
    expect(section).not.toContain("THEME_MARKETPLACE_URL");
    expect(section).not.toContain("function ThemeSelector");
    expect(section).not.toContain("getThemesForTarget");
    expect(section).not.toContain("surfaceThemePreferences");
    expect(section).not.toContain("onThemeOverrideChange");
    expect(section).not.toContain("themes.reload");
    expect(section).not.toContain("CustomCssEditor");
    expect(section).not.toContain("settings.appearance.themes.detail");
    expect(section).toContain("catalog.openDirectory");
    expect(section).toContain("snapshot.diagnostics.map");
    expect(section).toContain("desktop-settings-select");
    const styles = source("src/styles/settings-controls.css");
    expect(styles).toMatch(/\.desktop-theme-pack-controls\s*\{[\s\S]*flex-wrap:\s*nowrap/);
    expect(styles).toMatch(/\.desktop-theme-pack-controls\s*\{[^}]*height:\s*var\(--po-control-size-compact\)/);
    expect(styles).not.toMatch(/\.desktop-theme-pack-controls\s*\{[^}]*(?:padding|border|background):/);
    expect(styles).toMatch(/\.desktop-theme-pack-label\s*\{[^}]*white-space:\s*nowrap/);
    expect(styles).toMatch(/\.desktop-theme-pack-controls\s*\{[^}]*width:\s*max-content[^}]*max-width:\s*100%/);
    expect(section).toContain("desktop-theme-pack-picker");
    expect(styles).toMatch(/\.desktop-theme-pack-picker\s*\{[^}]*width:\s*fit-content[^}]*max-width:\s*156px/);
    expect(styles).toMatch(/\.desktop-theme-pack-select\s*\{[^}]*min-width:\s*124px[^}]*max-width:\s*156px[^}]*field-sizing:\s*content/);
    expect(section).not.toContain("desktop-theme-settings-action-row");
    expect(section.match(/desktop-settings-row desktop-settings-row-control/g)).toHaveLength(1);
    expect(section.indexOf("desktop-theme-pack-select")).toBeLessThan(section.indexOf("catalog.openDirectory"));
    expect(styles).toMatch(/\.desktop-theme-pack-icon-action\s*\{[^}]*width:\s*var\(--po-control-size-compact\)[^}]*height:\s*var\(--po-control-size-compact\)[^}]*border:\s*0/);
    expect(styles).not.toMatch(/@media\s*\(max-width:\s*760px\)[\s\S]*\.desktop-theme-pack-controls\s*\{[^}]*width:\s*100%/);
  });

  it("wires the catalog and preferences through the settings surface", () => {
    const app = source("src/App.tsx");
    const surface = source("src/features/settings/SettingsWorkspaceSurface.tsx");
    const view = source("src/features/settings/SettingsView.tsx");
    const typography = source("src/features/settings/main/TypographySettingsView.tsx");

    expect(app).toContain("subThemeCatalog={subThemeCatalog}");
    expect(surface).toContain("subThemeCatalog: SubThemeCatalogController");
    expect(surface).toContain("preferences.requestedSubThemeId");
    expect(surface).toContain("preferences.setSubThemeId");
    expect(surface).not.toContain("setSurfaceThemeOverride");
    expect(view).toContain("<SubThemeSettingsSection");
    expect(view).toContain("requestedSubThemeId={requestedSubThemeId}");
    expect(view.indexOf("<SubThemeSettingsSection")).toBeGreaterThan(view.indexOf('activeSection === "appearance"'));
    expect(view.indexOf("<SubThemeSettingsSection")).toBeGreaterThan(view.indexOf("<InterfacePaletteSettings"));
    expect(typography).not.toContain("ThemeSettingsSection");
  });
});
