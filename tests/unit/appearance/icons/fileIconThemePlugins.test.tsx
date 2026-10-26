import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FILE_VISUAL_KINDS, type FileIconThemeId } from "../../../../packages/shared-ui/src/file/fileIconTypes";
import { FileGlyphIcon } from "../../../../packages/shared-ui/src/file/fileIcons";
import { defaultTheme } from "../../../../packages/shared-ui/src/file/icon-themes/default";
import {
  FILE_ICON_THEME_REGISTRY,
  FILE_ICON_THEMES,
  getFileIconThemeDefinition,
} from "../../../../packages/shared-ui/src/file/icon-themes/registry";
import { createThemeVariant } from "../../../../packages/shared-ui/src/file/icon-themes/themeFactory";
import {
  PLUGIN_FILE_ICON_THEME_ID,
  pluginFileIconTheme,
} from "../../../support/appearance/pluginFileIconTheme";

const context = (kind: (typeof FILE_VISUAL_KINDS)[number]) => ({
  kind,
  name: `fixture.${kind}`,
  type: kind,
  label: kind.toUpperCase(),
  size: 18,
  color: "currentColor",
});

describe("file icon theme plug-in contract", () => {
  it("ships the default theme through the same registry a plug-in uses", () => {
    expect(FILE_ICON_THEMES).toEqual([{ id: "default" }]);
    expect(FILE_ICON_THEME_REGISTRY.default).toBe(defaultTheme);
    expect(getFileIconThemeDefinition("unknown" as FileIconThemeId)).toBe(defaultTheme);
  });

  it("draws Markdown and plain text as the document page in the label's ink", () => {
    const glyph = (name: string) => renderToStaticMarkup(<FileGlyphIcon name={name} type="file" size={18} />);
    for (const name of ["notes.md", "notes.txt", "spec.pdf"]) {
      expect(glyph(name), name).toContain('data-file-icon-shape="document"');
    }
    expect(glyph("notes.md")).toContain('stroke="currentColor"');
    expect(glyph("notes.md")).not.toContain("--po-file-accent-markdown");
    expect(glyph("notes.md")).toBe(glyph("notes.txt"));
    // Two lines of text on the page, one long and one short, in the outline's ink and weight.
    expect(glyph("notes.md")).toContain('d="M5.85 9.25h5.2M5.85 11.75h3.65"');
    expect(glyph("notes.md")).not.toContain("opacity");
    expect(new Set(glyph("notes.md").match(/stroke-width="[^"]+"/g))).toEqual(new Set(['stroke-width="1"']));
  });

  it("lets a factory-built theme draw every file kind and the shared preview shell", () => {
    for (const kind of FILE_VISUAL_KINDS) {
      const glyph = renderToStaticMarkup(pluginFileIconTheme.renderGlyph(context(kind)));
      expect(glyph, kind).toContain(`data-plugin-file-icon="${kind}"`);
    }
    const folder = renderToStaticMarkup(pluginFileIconTheme.renderPreview({ ...context("folder"), size: 56, childrenCount: 3 }));
    expect(folder).toContain('data-plugin-file-icon="folder"');
    expect(folder).toContain(">3</span>");
    expect(pluginFileIconTheme.id).toBe(PLUGIN_FILE_ICON_THEME_ID);
  });

  it("lets a variant override a few kinds and inherit every other one from its base", () => {
    const variant = createThemeVariant({
      id: PLUGIN_FILE_ICON_THEME_ID,
      base: defaultTheme,
      glyphOverrides: { markdown: pluginFileIconTheme.renderGlyph },
    });
    expect(renderToStaticMarkup(variant.renderGlyph(context("markdown")))).toContain('data-plugin-file-icon="markdown"');
    for (const kind of FILE_VISUAL_KINDS.filter((candidate) => candidate !== "markdown")) {
      expect(renderToStaticMarkup(variant.renderGlyph(context(kind))), kind)
        .toBe(renderToStaticMarkup(defaultTheme.renderGlyph(context(kind))));
    }
  });

  it("offers the File icons choice in Appearance only once a second theme is registered", () => {
    const appearance = readFileSync(
      new URL("../../../../src/features/settings/main/AppearanceSettingsView.tsx", import.meta.url),
      "utf8",
    );
    expect(appearance).toContain("{FILE_ICON_THEMES.length > 1 && <FileIconSetting />}");
  });
});
